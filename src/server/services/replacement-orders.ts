import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { orderItems, orders } from "@/server/db/schema";
import { generateOrderRef } from "@/server/domain";
import { getVariantAvailability, adjustStock, type Tx } from "@/server/services/inventory";
import { addOrderEvent } from "@/server/services/order-events";

/**
 * Replacement orders (plan 7.8): a support case resolved with "replacement" ships the customer a new
 * order at no charge. One function, one caller-owned transaction, so the stock decrement, the order and
 * the case outcome commit (or roll back) together.
 *
 * Shape of a replacement order (documented choices, no schema change):
 *  - `status = confirmed`, `fulfillment_status = unfulfilled`: it goes straight to the packing queue.
 *  - Totals are all 0 (`orders_total_consistent` holds: 0 = 0 - 0 + 0 + 0). Lines carry unit price 0
 *    and the original MRP/HSN/GST snapshots, so the packing slip and any document still describe the goods.
 *  - `payment_status = paid`: nothing is owed and nothing is to be collected. `cod_pending` would
 *    make the COD flows ("mark cash collected", RTO write-offs) apply to an order with no cash, and
 *    `unpaid` would make it look abandoned. `paid` with a ₹0 total is the one settled state; no `payments`
 *    row exists, so `refundable = 0` and the refund tooling correctly offers nothing.
 *  - `payment_method` is copied from the original (the enum has no "none"); it is never charged.
 *  - `idempotency_key = replacement:<caseId>`: the unique key makes a second replacement for the same
 *    case impossible, and marks the order for reports (see `isReplacementKey`).
 *  - Contact, address, user and vibe are copied from the original.
 */

export const REPLACEMENT_KEY_PREFIX = "replacement:";

export function replacementKey(caseId: string): string {
  return `${REPLACEMENT_KEY_PREFIX}${caseId}`;
}

export function isReplacementKey(key: string): boolean {
  return key.startsWith(REPLACEMENT_KEY_PREFIX);
}

/** A replacement line: an item of the original order and how many units to send again. */
export const replacementLineSchema = z.object({
  orderItemId: z.uuid(),
  qty: z.number().int("Whole units only").positive("Enter a quantity of at least 1"),
});
export type ReplacementLine = z.infer<typeof replacementLineSchema>;

export class ReplacementError extends Error {
  constructor(
    message: string,
    readonly code:
      "no_lines" | "unknown_line" | "too_many" | "insufficient_stock" | "ref_allocation",
  ) {
    super(message);
    this.name = "ReplacementError";
  }
}

export interface ReplacementOrderResult {
  orderId: string;
  ref: string;
  /** Products whose stock changed (for `revalidateStock`). */
  productIds: string[];
  units: number;
}

type OrderRow = typeof orders.$inferSelect;

export async function createReplacementOrder(
  tx: Tx,
  input: {
    original: OrderRow;
    caseId: string;
    lines: readonly ReplacementLine[];
    actorId: string | null;
    now?: Date;
  },
): Promise<ReplacementOrderResult> {
  const { original, caseId } = input;
  const now = input.now ?? new Date();
  if (input.lines.length === 0)
    throw new ReplacementError("Pick at least one item to replace.", "no_lines");

  const sourceItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, original.id));
  const byId = new Map(sourceItems.map((i) => [i.id, i]));

  // Merge duplicate lines and validate against what the customer actually bought.
  const wanted = new Map<string, number>();
  for (const l of input.lines) wanted.set(l.orderItemId, (wanted.get(l.orderItemId) ?? 0) + l.qty);
  const picked = [...wanted.entries()].map(([id, qty]) => {
    const item = byId.get(id);
    if (!item)
      throw new ReplacementError(
        "One of the selected items is not on the original order.",
        "unknown_line",
      );
    if (qty > item.qty) {
      throw new ReplacementError(
        `${item.productName}: the order has ${item.qty}, so at most ${item.qty} can be replaced.`,
        "too_many",
      );
    }
    return { item, qty };
  });

  // Lock the variants in a deterministic order (same as checkout), then check live availability:
  // reservations held by pending checkouts count against the shelf.
  const need = new Map<string, number>();
  for (const { item, qty } of picked)
    need.set(item.variantId, (need.get(item.variantId) ?? 0) + qty);
  const variantIds = [...need.keys()].sort();
  const availability = await getVariantAvailability(variantIds, tx, { now, lock: true });
  const available = new Map(availability.map((a) => [a.variantId, a.available]));
  const short = picked.filter(
    ({ item }) => (available.get(item.variantId) ?? 0) < (need.get(item.variantId) ?? 0),
  );
  if (short.length > 0) {
    const first = short[0]!;
    const left = available.get(first.item.variantId) ?? 0;
    throw new ReplacementError(
      `Not enough stock to send ${first.item.productName}${first.item.variantTitle !== "Default" ? ` (${first.item.variantTitle})` : ""}: ${left} available, ${need.get(first.item.variantId)} needed. Restock it, or choose a refund instead.`,
      "insufficient_stock",
    );
  }

  let created: OrderRow | undefined;
  for (let attempt = 0; attempt < 8 && !created; attempt++) {
    [created] = await tx
      .insert(orders)
      .values({
        ref: generateOrderRef(now),
        userId: original.userId,
        cartId: null,
        email: original.email,
        phone: original.phone,
        status: "confirmed",
        paymentStatus: "paid",
        fulfillmentStatus: "unfulfilled",
        paymentMethod: original.paymentMethod,
        subtotalPaise: 0,
        discountPaise: 0,
        shippingPaise: 0,
        codFeePaise: 0,
        totalPaise: 0,
        taxIncludedPaise: 0,
        couponCode: null,
        shippingAddress: original.shippingAddress,
        billingAddress: original.billingAddress,
        vibeAtOrder: original.vibeAtOrder,
        accessTokenHash: null,
        idempotencyKey: replacementKey(caseId),
        policyAckVersion: original.policyAckVersion,
        placedAt: now,
        paidAt: now,
      })
      .onConflictDoNothing({ target: orders.ref })
      .returning();
  }
  if (!created)
    throw new ReplacementError(
      "Could not allocate a unique order reference. Try again.",
      "ref_allocation",
    );

  await tx.insert(orderItems).values(
    picked.map(({ item, qty }) => ({
      orderId: created!.id,
      variantId: item.variantId,
      productId: item.productId,
      productName: item.productName,
      variantTitle: item.variantTitle,
      sku: item.sku,
      imagePath: item.imagePath,
      unitPricePaise: 0,
      mrpPaise: item.mrpPaise,
      qty,
      discountAllocPaise: 0,
      lineTotalPaise: 0,
      hsn: item.hsn,
      gstRateBp: item.gstRateBp,
      taxPaise: 0,
    })),
  );

  // Stock leaves the shelf through the ledger, one `sale` movement per variant, in id order.
  for (const variantId of variantIds) {
    await adjustStock(
      {
        variantId,
        delta: -(need.get(variantId) ?? 0),
        reason: "sale",
        actorId: input.actorId,
        orderId: created.id,
        note: `Replacement for ${original.ref}`,
      },
      tx,
    );
  }

  const units = picked.reduce((n, p) => n + p.qty, 0);
  await addOrderEvent(tx, created.id, {
    type: "order_placed",
    to: "confirmed",
    note: `Replacement for order ${original.ref}. No charge.`,
    visible: true,
    actorId: input.actorId,
  });
  await addOrderEvent(tx, created.id, {
    type: "replacement_of",
    note: `Replacement for ${original.ref} (support case ${caseId.slice(0, 8)}), ${units} unit(s).`,
    actorId: input.actorId,
  });
  await addOrderEvent(tx, created.id, {
    type: "stock_decremented",
    note: "Stock sold (replacement order).",
    actorId: input.actorId,
  });
  await addOrderEvent(tx, original.id, {
    type: "replacement_created",
    note: `Replacement order ${created.ref} created from support case ${caseId.slice(0, 8)} (${units} unit(s)).`,
    visible: true,
    actorId: input.actorId,
  });

  const productIds = [
    ...new Set(picked.map((p) => p.item.productId).filter((id): id is string => id !== null)),
  ];
  return { orderId: created.id, ref: created.ref, productIds, units };
}
