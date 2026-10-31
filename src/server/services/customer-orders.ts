import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { orderItems, orders } from "@/server/db/schema";
import {
  customerStatusLabel,
  hashAccessToken,
  isCustomerCancellable,
  normalizeOrderRef,
  type CustomerStatusLabel,
  type FulfillmentStatus,
  type OrderStatus,
  type PaymentMethod,
} from "@/server/domain";
import type { PaymentProvider } from "@/server/payments/provider";

import { AdminInputError } from "./admin/products";
import { orderTokenMatches } from "./commerce/order-token";
import { cancelOrderCore, type OrderRow } from "./admin/orders";
import { toCustomerOrderView, type CustomerOrderView } from "./orders";
import { readSettings, type DbClient } from "./queries/shared";
import { consumeRateLimit } from "./rate-limit";

/**
 * Customer-side order access and actions (plan 7.8, 7.11): who may see or cancel an order, the
 * account order history, and the customer cancel built on the same transaction as the admin cancel.
 *
 * Two ways to prove you own an order:
 *  - `token`: the guest `?t=` link (constant-time hash compare);
 *  - `account`: a signed-in customer whose `userId` is on the order, or whose VERIFIED account
 *    e-mail equals the order e-mail (guest orders placed before signing up show up after the OTP
 *    sign-in proves the address).
 * Everything else is the same `null` / "not found", so refs cannot be probed.
 */

export type OrderAccess =
  | { kind: "token"; token: string }
  | {
      kind: "account";
      userId: string;
      /** The account e-mail, only when it is verified; null makes ownership `userId`-only. */
      email: string | null;
    };

const DUMMY_HASH = hashAccessToken("ifonli-no-such-order");

function ownerClause(userId: string, email: string | null): SQL {
  const byUser = eq(orders.userId, userId);
  if (!email) return byUser;
  return or(byUser, sql`lower(${orders.email}) = ${email.trim().toLowerCase()}`) as SQL;
}

/** The order row when `access` proves ownership, else null (same answer for every kind of miss). */
export async function findOrderForAccess(
  db: DbClient,
  ref: string,
  access: OrderAccess,
): Promise<OrderRow | null> {
  const normalized = normalizeOrderRef(ref);
  if (access.kind === "token") {
    const [order] = await db.select().from(orders).where(eq(orders.ref, normalized)).limit(1);
    const ok = orderTokenMatches(access.token ?? "", order?.accessTokenHash ?? DUMMY_HASH);
    return order && order.accessTokenHash && ok ? order : null;
  }
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.ref, normalized), ownerClause(access.userId, access.email)))
    .limit(1);
  return order ?? null;
}

/** Customer order page data for a signed-in owner (same view as the guest page). */
export async function getOrderForAccount(
  db: DbClient,
  ref: string,
  access: Extract<OrderAccess, { kind: "account" }>,
): Promise<CustomerOrderView | null> {
  const order = await findOrderForAccess(db, ref, access);
  return order ? toCustomerOrderView(db, order) : null;
}

/* ------------------------------------------------------------------------------------------ */
/* History                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export interface AccountOrderSummary {
  ref: string;
  placedAt: Date;
  status: OrderStatus;
  statusLabel: CustomerStatusLabel;
  paymentMethod: PaymentMethod;
  totalPaise: number;
  itemCount: number;
  /** Up to three line names, for a one-line summary. */
  itemNames: string[];
  /** Up to three thumbnails (storage paths; resolve with `resolveImageUrl`). */
  imagePaths: string[];
}

export const ACCOUNT_ORDERS_PAGE_SIZE = 10;

/**
 * Orders of a signed-in customer, newest first: the ones linked to the account plus guest orders
 * placed with the account's verified e-mail. Expired checkouts (never paid, stock released) are left
 * out: they are abandoned baskets, not orders.
 */
export async function listAccountOrders(
  db: DbClient,
  access: Extract<OrderAccess, { kind: "account" }>,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ orders: AccountOrderSummary[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? ACCOUNT_ORDERS_PAGE_SIZE, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = and(ownerClause(access.userId, access.email), ne(orders.status, "expired"));

  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(limit)
      .offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(where),
  ]);
  const items = rows.length
    ? await db
        .select({
          orderId: orderItems.orderId,
          name: orderItems.productName,
          qty: orderItems.qty,
          imagePath: orderItems.imagePath,
        })
        .from(orderItems)
        .where(
          inArray(
            orderItems.orderId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(orderItems.createdAt), asc(orderItems.id))
    : [];
  const byOrder = new Map<string, typeof items>();
  for (const item of items) byOrder.set(item.orderId, [...(byOrder.get(item.orderId) ?? []), item]);

  return {
    total: count?.n ?? 0,
    orders: rows.map((o) => {
      const lines = byOrder.get(o.id) ?? [];
      return {
        ref: o.ref,
        placedAt: o.placedAt,
        status: o.status,
        statusLabel: customerStatusLabel(o),
        paymentMethod: o.paymentMethod,
        totalPaise: o.totalPaise,
        itemCount: lines.reduce((n, l) => n + l.qty, 0),
        itemNames: lines.slice(0, 3).map((l) => l.name),
        imagePaths: lines.flatMap((l) => (l.imagePath ? [l.imagePath] : [])).slice(0, 3),
      };
    }),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Cancel                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * Parcels already handed to a courier cannot be recalled, so whatever the owner puts in
 * `settings.cancellable_statuses`, a customer can never cancel past these two (the admin cancel has
 * the same hard limit). The setting only narrows it (placeholder: `unfulfilled`).
 */
export const CUSTOMER_CANCEL_HARD_LIMIT: readonly FulfillmentStatus[] = ["unfulfilled", "packed"];

export type CancelBlock = "cancelled" | "not_open" | "in_progress";

export type CancelEligibility = { ok: true } | { ok: false; code: CancelBlock; message: string };

/** Pure rule: can a customer cancel this order right now, given the owner's setting? */
export function customerCancelEligibility(
  order: Pick<OrderRow, "status" | "paymentStatus" | "fulfillmentStatus">,
  cancellableStatuses: readonly FulfillmentStatus[],
): CancelEligibility {
  if (order.status === "cancelled") {
    return { ok: false, code: "cancelled", message: "This order is already cancelled." };
  }
  const allowed = cancellableStatuses.filter((s) => CUSTOMER_CANCEL_HARD_LIMIT.includes(s));
  if (isCustomerCancellable(order, allowed)) return { ok: true };
  if (order.status === "completed" || order.status === "expired" || order.paymentStatus === "refunded") {
    return { ok: false, code: "not_open", message: "This order can't be cancelled any more." };
  }
  return {
    ok: false,
    code: "in_progress",
    message:
      "Your order is already being prepared or is on its way, so it can't be cancelled online any more. Please contact us and we'll see what we can do.",
  };
}

/** The owner's cancellable list, read through `db`. */
export async function loadCancellableStatuses(db: DbClient): Promise<readonly FulfillmentStatus[]> {
  const { cancellable_statuses } = await readSettings(db, ["cancellable_statuses"]);
  return cancellable_statuses.value;
}

export const customerCancelInputSchema = z.object({
  reason: z.string().trim().max(300, "Keep the reason under 300 characters").optional(),
});

export interface CustomerCancelResult {
  /** True when the order was already cancelled (a repeat click or a second tab): nothing changed. */
  alreadyCancelled: boolean;
  paymentMethod: PaymentMethod;
  /** Prepaid: the automatic refund that was started for the money taken. */
  refund: { refundId: string; status: string; amountPaise: number } | null;
  /** The order is cancelled but the refund could not be started yet (we retry and the team is told). */
  refundError: string | null;
  /** Products whose stock changed (for `revalidateStock`). */
  productIds: string[];
}

export type CustomerCancelOutcome =
  | ({ ok: true } & CustomerCancelResult)
  | {
      ok: false;
      code: "not_found" | "not_cancellable" | "invalid" | "rate_limited";
      message: string;
      retryAfterSeconds?: number;
    };

export const CUSTOMER_CANCEL_LIMITS = {
  ip: { limit: 20, windowSeconds: 600 },
  ref: { limit: 6, windowSeconds: 600 },
} as const;

class NotCancellable extends Error {
  constructor(
    readonly code: CancelBlock,
    message: string,
  ) {
    super(message);
    this.name = "NotCancellable";
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/**
 * Customer cancel (plan 7.8). Allowed while the fulfilment status is in `settings.cancellable_statuses`
 * (and never past packed). Prepaid orders are refunded in full automatically, COD orders are just
 * cancelled; stock goes back through `cancel_restock`, the coupon is released and the customer gets
 * the cancellation e-mail. Idempotent: cancelling a cancelled order returns `alreadyCancelled`.
 * Rate limited by IP and by order. The caller (Server Action) revalidates stock and sends the outbox.
 */
export async function cancelOrderForCustomer(
  db: DbClient,
  input: { ref: string; access: OrderAccess; reason?: unknown; ip: string },
  deps: { provider?: PaymentProvider } = {},
): Promise<CustomerCancelOutcome> {
  const parsed = customerCancelInputSchema.safeParse({ reason: input.reason ?? undefined });
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Check the reason and try again." };
  }
  const decisions = await Promise.all([
    consumeRateLimit(db, `cancel:ip:${input.ip}`, CUSTOMER_CANCEL_LIMITS.ip),
    consumeRateLimit(db, `cancel:ref:${digest(normalizeOrderRef(input.ref))}`, CUSTOMER_CANCEL_LIMITS.ref),
  ]);
  const blocked = decisions.find((d) => !d.allowed);
  if (blocked) {
    return {
      ok: false,
      code: "rate_limited",
      message: "Too many attempts. Please wait a few minutes and try again.",
      retryAfterSeconds: blocked.retryAfterSeconds,
    };
  }

  const order = await findOrderForAccess(db, input.ref, input.access);
  if (!order) return { ok: false, code: "not_found", message: "We couldn't find that order." };

  const base = { paymentMethod: order.paymentMethod, refund: null, refundError: null, productIds: [] };
  if (order.status === "cancelled") return { ok: true, alreadyCancelled: true, ...base };

  const cancellable = await loadCancellableStatuses(db);
  const verdict = customerCancelEligibility(order, cancellable);
  if (!verdict.ok) return { ok: false, code: "not_cancellable", message: verdict.message };

  const reason = parsed.data.reason || "No reason given";
  try {
    const result = await cancelOrderCore(db, order.id, {
      reason,
      actorId: input.access.kind === "account" ? input.access.userId : null,
      by: "customer",
      provider: deps.provider,
      // Re-checked under the row lock: a staff action may have moved the order since the read above.
      guard: (locked) => {
        const again = customerCancelEligibility(locked, cancellable);
        if (!again.ok) throw new NotCancellable(again.code, again.message);
      },
    });
    return {
      ok: true,
      alreadyCancelled: false,
      paymentMethod: order.paymentMethod,
      refund: result.refund,
      refundError: result.refundError,
      productIds: result.productIds,
    };
  } catch (e) {
    if (e instanceof NotCancellable || e instanceof AdminInputError) {
      // A concurrent cancel (second tab) won the race: report success without doing anything twice.
      const [now] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id));
      if (now?.status === "cancelled") return { ok: true, alreadyCancelled: true, ...base };
      return {
        ok: false,
        code: "not_cancellable",
        message: e instanceof NotCancellable ? e.message : "This order can't be cancelled any more.",
      };
    }
    throw e;
  }
}
