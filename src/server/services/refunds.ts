import "server-only";

import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import { inventoryMovements, orderItems, orders, payments, refunds } from "@/server/db/schema";
import { assertTransition, refundableAmount, type PaymentStatus } from "@/server/domain";
import { enqueueAdminAlert, enqueueCustomerNotification } from "@/server/notify/outbox";
import { PaymentProviderError, type PaymentProvider, type ProviderRefund } from "@/server/payments/provider";
import { getPaymentProvider } from "@/server/payments/registry";
import { formatINR } from "@/lib/money";

import { writeAudit } from "./audit";
import { adjustStock } from "./inventory";
import { addOrderEvent } from "./order-events";
import type { DbClient } from "./queries/shared";

/* ------------------------------------------------------------------------------------------ */
/* Bookkeeping                                                                                */
/* ------------------------------------------------------------------------------------------ */

type OrderRow = typeof orders.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type RefundRow = typeof refunds.$inferSelect;

/** `payments.raw.disposition`: set when a captured payment was NOT the one that paid the order. */
export type PaymentDisposition = "duplicate" | "no_stock" | "order_closed";

export function dispositionOf(row: Pick<PaymentRow, "raw">): PaymentDisposition | null {
  const d = (row.raw as { disposition?: unknown } | null)?.disposition;
  return d === "duplicate" || d === "no_stock" || d === "order_closed" ? d : null;
}

/** Statuses that count against what can still be refunded (a pending refund has the money reserved). */
const COUNTING: RefundRow["status"][] = ["pending", "processed", "manual"];
/** Statuses where the money actually left the store. */
const SETTLED: RefundRow["status"][] = ["processed", "manual"];

interface RefundTotals {
  /** Money the order took (captured online, or the order total once COD cash is collected). */
  capturedPaise: number;
  /** Pending + processed + manual: not available for another refund. */
  committedPaise: number;
  /** Processed + manual: already back with the customer. */
  settledPaise: number;
  /** Captured payment rows that belong to the order (duplicates are refunded separately). */
  paymentRows: PaymentRow[];
}

/**
 * Per-order refund arithmetic. Online orders: the captured payment rows of the order, excluding
 * duplicate charges (those are refunded in full on their own). COD: nothing is refundable until the
 * cash is collected; refunds are manual rows without a payment.
 */
export async function loadRefundTotals(tx: DbClient, order: OrderRow): Promise<RefundTotals> {
  if (order.paymentMethod === "cod") {
    const collected =
      order.paymentStatus === "cod_collected" ||
      order.paymentStatus === "partially_refunded" ||
      order.paymentStatus === "refunded";
    const rows = await tx.select().from(refunds).where(eq(refunds.orderId, order.id));
    return {
      capturedPaise: collected ? order.totalPaise : 0,
      committedPaise: rows.filter((r) => COUNTING.includes(r.status)).reduce((s, r) => s + r.amountPaise, 0),
      settledPaise: rows.filter((r) => SETTLED.includes(r.status)).reduce((s, r) => s + r.amountPaise, 0),
      paymentRows: [],
    };
  }
  const all = await tx.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(asc(payments.createdAt), asc(payments.id));
  const paymentRows = all.filter((p) => p.status === "captured" && dispositionOf(p) !== "duplicate");
  const ids = paymentRows.map((p) => p.id);
  const rows = ids.length ? await tx.select().from(refunds).where(inArray(refunds.paymentId, ids)) : [];
  return {
    capturedPaise: paymentRows.reduce((s, p) => s + p.amountPaise, 0),
    committedPaise: rows.filter((r) => COUNTING.includes(r.status)).reduce((s, r) => s + r.amountPaise, 0),
    settledPaise: rows.filter((r) => SETTLED.includes(r.status)).reduce((s, r) => s + r.amountPaise, 0),
    paymentRows,
  };
}

const PAYMENT_STEPS: Record<string, PaymentStatus[]> = {
  // unpaid + captured money (late capture refunded before the order was ever marked paid)
  unpaid: ["paid"],
  failed: ["paid"],
};

/**
 * Moves `orders.payment_status` to `partially_refunded` / `refunded` from the SETTLED refund total
 * (money really returned, so the status never runs ahead of reality and never needs to go back).
 * Walks the allowed transitions one step at a time (`unpaid -> paid -> refunded`). Call under the
 * order row lock.
 */
export async function settlePaymentStatus(tx: DbClient, orderId: string): Promise<PaymentStatus> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error(`Order ${orderId} not found`);
  const totals = await loadRefundTotals(tx, order);
  if (totals.settledPaise <= 0 || totals.capturedPaise <= 0) return order.paymentStatus;
  const target: PaymentStatus = totals.settledPaise >= totals.capturedPaise ? "refunded" : "partially_refunded";

  let current = order.paymentStatus;
  if (current === target) return current;
  // Walk forward through legal steps; never move backwards (refunded stays refunded).
  for (const step of [...(PAYMENT_STEPS[current] ?? []), target]) {
    if (step === current) continue;
    assertTransition("payment", current, step);
    current = step;
  }
  await tx.update(orders).set({ paymentStatus: current }).where(eq(orders.id, orderId));
  return current;
}

/* ------------------------------------------------------------------------------------------ */
/* Outcomes (shared by the provider response, the webhook and the sweeper)                    */
/* ------------------------------------------------------------------------------------------ */

/**
 * Idempotent: the refund becomes `processed` once, settles the order's payment status, and writes
 * the timeline event and the "refund processed" notification. Replays are no-ops.
 */
export async function markRefundProcessed(db: DbClient, refundId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [peek] = await tx.select({ orderId: refunds.orderId }).from(refunds).where(eq(refunds.id, refundId));
    if (!peek) return false;
    const [order] = await tx.select().from(orders).where(eq(orders.id, peek.orderId)).for("update");
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for("update");
    if (!order || !r || r.status === "processed" || r.status === "manual") return false;
    await tx.update(refunds).set({ status: "processed" }).where(eq(refunds.id, refundId));
    await settlePaymentStatus(tx, order.id);
    await addOrderEvent(tx, order.id, {
      type: "refund_processed",
      note: `Refund of ${formatINR(r.amountPaise)} processed.`,
      visible: true,
    });
    await enqueueCustomerNotification(tx, {
      orderId: order.id,
      template: "refund_processed",
      to: order.email,
      payload: { ref: order.ref, refundId, amountPaise: r.amountPaise },
    });
    return true;
  });
}

/** Idempotent: a refund the provider reports as failed. The money did not move; an admin must act. */
export async function markRefundFailed(db: DbClient, refundId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [peek] = await tx.select({ orderId: refunds.orderId }).from(refunds).where(eq(refunds.id, refundId));
    if (!peek) return false;
    const [order] = await tx.select().from(orders).where(eq(orders.id, peek.orderId)).for("update");
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for("update");
    if (!order || !r || r.status !== "pending") return false;
    await tx.update(refunds).set({ status: "failed" }).where(eq(refunds.id, refundId));
    await addOrderEvent(tx, order.id, {
      type: "refund_failed",
      note: `Refund of ${formatINR(r.amountPaise)} failed at the payment provider.`,
    });
    await enqueueAdminAlert(tx, {
      orderId: order.id,
      template: "payment_anomaly",
      payload: { kind: "refund_failed", ref: order.ref, refundId, amountPaise: r.amountPaise },
    });
    return true;
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Provider execution                                                                         */
/* ------------------------------------------------------------------------------------------ */

export type ExecuteRefundResult =
  | { status: "issued"; providerRefundId: string }
  | { status: "skipped" }
  | { status: "error"; message: string; retryable: boolean };

/**
 * Sends one `pending` refund row to the provider, exactly once. Safe to call from any number of
 * places (the creating request, the webhook path, the retry sweeper): the row is locked, and a
 * refund that already reached the provider (crash between the API call and our write) is adopted
 * from the provider's own list via the `refund_id` note instead of being issued again.
 */
export async function executeRefund(
  db: DbClient,
  refundId: string,
  provider: PaymentProvider = getPaymentProvider(),
): Promise<ExecuteRefundResult> {
  let outcome: ExecuteRefundResult;
  const seen: { status: ProviderRefund["status"] } = { status: "pending" };
  try {
    outcome = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for("update");
      if (!r || r.status !== "pending" || r.providerRefundId || !r.paymentId) {
        return { status: "skipped" } as const;
      }
      const [pay] = await tx.select().from(payments).where(eq(payments.id, r.paymentId));
      if (!pay?.providerPaymentId) return { status: "skipped" } as const;

      const known = (await provider.listRefunds(pay.providerPaymentId)).find(
        (x) => x.notes.refund_id === r.id || x.receipt === r.id,
      );
      const pr =
        known ??
        (await provider.refund(pay.providerPaymentId, {
          amountPaise: r.amountPaise,
          receipt: r.id,
          notes: { refund_id: r.id, order_id: r.orderId },
        }));
      await tx.update(refunds).set({ providerRefundId: pr.id }).where(eq(refunds.id, r.id));
      seen.status = pr.status;
      return { status: "issued", providerRefundId: pr.id } as const;
    });
  } catch (e) {
    const retryable = e instanceof PaymentProviderError ? e.retryable : true;
    const message = e instanceof Error ? e.message : "Refund request failed";
    // A refund the provider rejects for good (not retryable) will never succeed: surface it.
    if (!retryable) await markRefundFailed(db, refundId);
    return { status: "error", message, retryable };
  }
  if (outcome.status === "issued") {
    if (seen.status === "processed") await markRefundProcessed(db, refundId);
    else if (seen.status === "failed") await markRefundFailed(db, refundId);
  }
  return outcome;
}

/**
 * Applies a provider refund entity (webhook `refund.*` events, or a poll) to our rows. Unknown
 * refunds on one of our payments (made from the Razorpay dashboard) are recorded so the books match.
 */
export async function reconcileProviderRefund(db: DbClient, pr: ProviderRefund): Promise<void> {
  const noteId = pr.notes.refund_id;
  const isUuid = typeof noteId === "string" && /^[0-9a-f-]{36}$/i.test(noteId);

  let ours =
    (await db.select().from(refunds).where(eq(refunds.providerRefundId, pr.id)).limit(1))[0] ?? null;
  if (!ours && isUuid) {
    ours = (await db.select().from(refunds).where(eq(refunds.id, noteId!)).limit(1))[0] ?? null;
  }

  if (!ours) {
    const [pay] = await db.select().from(payments).where(eq(payments.providerPaymentId, pr.paymentId));
    if (!pay) return; // not a payment of this store
    await db.transaction(async (tx) => {
      await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, pay.orderId)).for("update");
      await tx
        .insert(refunds)
        .values({
          orderId: pay.orderId,
          paymentId: pay.id,
          providerRefundId: pr.id,
          amountPaise: pr.amountPaise,
          reason: "Refund issued from the payment provider dashboard",
          status: "pending",
        })
        .onConflictDoNothing({ target: refunds.providerRefundId });
      await addOrderEvent(tx, pay.orderId, {
        type: "refund_recorded",
        note: `Refund of ${formatINR(pr.amountPaise)} found at the payment provider.`,
      });
    });
    ours = (await db.select().from(refunds).where(eq(refunds.providerRefundId, pr.id)).limit(1))[0] ?? null;
    if (!ours) return;
  } else if (!ours.providerRefundId) {
    await db.update(refunds).set({ providerRefundId: pr.id }).where(and(eq(refunds.id, ours.id), isNull(refunds.providerRefundId)));
  }

  if (pr.status === "processed") await markRefundProcessed(db, ours.id);
  else if (pr.status === "failed") await markRefundFailed(db, ours.id);
}

/**
 * Cron sweeper: (1) refunds that never reached the provider (a provider outage at the time) are
 * sent now; (2) refunds the provider accepted but whose webhook never arrived are polled.
 */
export async function retryPendingRefunds(
  db: DbClient,
  provider: PaymentProvider = getPaymentProvider(),
  opts: { now?: Date; limit?: number } = {},
): Promise<{ sent: number; polled: number; errors: number }> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 25;
  const stats = { sent: 0, polled: 0, errors: 0 };

  const unsent = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.status, "pending"),
        isNull(refunds.providerRefundId),
        sql`${refunds.paymentId} is not null`,
        lte(refunds.createdAt, new Date(now.getTime() - 60_000)),
      ),
    )
    .orderBy(asc(refunds.createdAt))
    .limit(limit);
  for (const { id } of unsent) {
    const r = await executeRefund(db, id, provider);
    if (r.status === "issued") stats.sent += 1;
    else if (r.status === "error") stats.errors += 1;
  }

  const stale = await db
    .select({ id: refunds.id, providerRefundId: refunds.providerRefundId, paymentId: refunds.paymentId })
    .from(refunds)
    .where(
      and(
        eq(refunds.status, "pending"),
        sql`${refunds.providerRefundId} is not null`,
        lte(refunds.updatedAt, new Date(now.getTime() - 30 * 60_000)),
      ),
    )
    .orderBy(asc(refunds.updatedAt))
    .limit(limit);
  for (const s of stale) {
    try {
      const [pay] = await db.select().from(payments).where(eq(payments.id, s.paymentId!));
      if (!pay?.providerPaymentId) continue;
      const match = (await provider.listRefunds(pay.providerPaymentId)).find((x) => x.id === s.providerRefundId);
      if (match) {
        await reconcileProviderRefund(db, match);
        stats.polled += 1;
      }
    } catch {
      stats.errors += 1;
    }
  }
  return stats;
}

/* ------------------------------------------------------------------------------------------ */
/* createRefund (admin / system)                                                              */
/* ------------------------------------------------------------------------------------------ */

export type RefundErrorCode =
  | "order_not_found"
  | "invalid_amount"
  | "nothing_refundable"
  | "exceeds_refundable"
  | "reference_required"
  | "invalid_restock";

export interface RestockLine {
  variantId: string;
  qty: number;
}

export interface CreateRefundInput {
  orderId: string;
  /** 1 ..= captured - already refunded (pending refunds count). */
  amountPaise: number;
  reason: string;
  actorId: string | null;
  /** UPI / bank reference. Required for COD (manual) refunds. */
  reference?: string | null;
  /** Put these units back on the shelf through the ledger. */
  restockLines?: RestockLine[];
  /** Ledger reason; defaults to `cancel_restock` before dispatch, else `return_restock`. */
  restockReason?: "cancel_restock" | "return_restock";
  now?: Date;
}

export type CreateRefundResult =
  | {
      ok: true;
      refundId: string;
      status: RefundRow["status"];
      providerRefundId: string | null;
      /** Products whose stock changed (for `revalidateStock`). */
      productIds: string[];
      /** Set when the provider call failed: the refund row is saved and the sweeper retries it. */
      providerError?: string;
    }
  | { ok: false; code: RefundErrorCode; message: string; maxPaise?: number };

class RefundAbort extends Error {
  constructor(readonly error: Extract<CreateRefundResult, { ok: false }>) {
    super(error.message);
  }
}

/**
 * Refunds part or all of an order (plan 7.8).
 *  - Online: validates against `captured - refunded`, saves a `pending` refunds row (and optionally
 *    restocks) in one transaction, then calls the provider outside it. The webhook (or the provider
 *    response) moves it to `processed`, which is when `payment_status` changes.
 *  - COD: recorded as `manual` with the UPI / bank reference, effective immediately.
 * Does not change `orders.status`; cancelling an order is a separate action that calls this.
 */
export async function createRefund(
  db: DbClient,
  input: CreateRefundInput,
  provider?: PaymentProvider,
): Promise<CreateRefundResult> {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
    return { ok: false, code: "invalid_amount", message: "Refund amount must be a positive whole number of paise." };
  }
  const fail = (error: Extract<CreateRefundResult, { ok: false }>): never => {
    throw new RefundAbort(error);
  };

  let created: { refund: RefundRow; productIds: string[]; order: OrderRow };
  try {
    created = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
      if (!order) return fail({ ok: false, code: "order_not_found", message: "Order not found." });
      if (
        order.paymentStatus !== "paid" &&
        order.paymentStatus !== "partially_refunded" &&
        order.paymentStatus !== "cod_collected"
      ) {
        return fail({ ok: false, code: "nothing_refundable", message: "This order has no collected payment to refund." });
      }
      const totals = await loadRefundTotals(tx, order);
      const maxPaise = refundableAmount(totals.capturedPaise, totals.committedPaise);
      if (input.amountPaise > maxPaise) {
        return fail({
          ok: false,
          code: "exceeds_refundable",
          message: `At most ${formatINR(maxPaise)} can still be refunded on this order.`,
          maxPaise,
        });
      }

      const isCod = order.paymentMethod === "cod";
      const reference = input.reference?.trim() || null;
      if (isCod && !reference) {
        return fail({ ok: false, code: "reference_required", message: "Enter the UPI / bank reference of the manual refund." });
      }
      // Online: refund against the captured payment that still has room for it.
      let target: PaymentRow | null = null;
      if (!isCod) {
        for (const p of totals.paymentRows) {
          const done = await tx.select({ n: sql<number>`coalesce(sum(${refunds.amountPaise}), 0)::int` }).from(refunds).where(and(eq(refunds.paymentId, p.id), inArray(refunds.status, COUNTING)));
          if (p.amountPaise - (done[0]?.n ?? 0) >= input.amountPaise) {
            target = p;
            break;
          }
        }
        if (!target) {
          return fail({ ok: false, code: "exceeds_refundable", message: "No single payment can cover that amount.", maxPaise });
        }
      }

      const productIds = await restock(tx, order, input);

      const [refund] = await tx
        .insert(refunds)
        .values({
          orderId: order.id,
          paymentId: target?.id ?? null,
          amountPaise: input.amountPaise,
          reason: input.reason,
          status: isCod ? "manual" : "pending",
          actorId: input.actorId,
          reference,
        })
        .returning();

      await writeAudit(tx, {
        actorId: input.actorId,
        action: "order.refund",
        entity: "order",
        entityId: order.id,
        diff: {
          amountPaise: input.amountPaise,
          reason: input.reason,
          method: isCod ? "manual" : "provider",
          restock: input.restockLines?.map((l) => ({ variantId: l.variantId, qty: l.qty })) ?? [],
        },
      });
      await addOrderEvent(tx, order.id, {
        type: isCod ? "refund_processed" : "refund_initiated",
        note: isCod
          ? `Manual refund of ${formatINR(input.amountPaise)} recorded (ref ${reference}).`
          : `Refund of ${formatINR(input.amountPaise)} initiated.`,
        visible: true,
        actorId: input.actorId,
      });
      await enqueueCustomerNotification(tx, {
        orderId: order.id,
        template: isCod ? "refund_processed" : "refund_initiated",
        to: order.email,
        payload: { ref: order.ref, refundId: refund!.id, amountPaise: input.amountPaise },
      });
      if (isCod) await settlePaymentStatus(tx, order.id);
      return { refund: refund!, productIds, order };
    });
  } catch (e) {
    if (e instanceof RefundAbort) return e.error;
    throw e;
  }

  const { refund, productIds } = created;
  if (refund.status === "manual") {
    return { ok: true, refundId: refund.id, status: "manual", providerRefundId: null, productIds };
  }
  const result = await executeRefund(db, refund.id, provider);
  if (result.status === "error") {
    return {
      ok: true,
      refundId: refund.id,
      status: "pending",
      providerRefundId: null,
      productIds,
      providerError: result.message,
    };
  }
  const [after] = await db.select().from(refunds).where(eq(refunds.id, refund.id));
  return {
    ok: true,
    refundId: refund.id,
    status: after?.status ?? "pending",
    providerRefundId: after?.providerRefundId ?? null,
    productIds,
  };
}

/** Puts units back through the ledger. Returns the affected product ids. */
async function restock(tx: DbClient, order: OrderRow, input: CreateRefundInput): Promise<string[]> {
  const lines = input.restockLines ?? [];
  if (lines.length === 0) return [];

  const merged = new Map<string, number>();
  for (const l of lines) {
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0) {
      throw new RefundAbort({ ok: false, code: "invalid_restock", message: "Restock quantities must be positive whole numbers." });
    }
    merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.qty);
  }
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const ordered = new Map(items.map((i) => [i.variantId, { qty: i.qty, productId: i.productId }]));
  const moved = await tx
    .select({ variantId: inventoryMovements.variantId, n: sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)::int` })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.orderId, order.id),
        inArray(inventoryMovements.reason, ["cancel_restock", "return_restock"]),
      ),
    )
    .groupBy(inventoryMovements.variantId);
  const alreadyBack = new Map(moved.map((m) => [m.variantId, m.n]));

  const reason =
    input.restockReason ?? (order.fulfillmentStatus === "unfulfilled" || order.fulfillmentStatus === "packed" ? "cancel_restock" : "return_restock");
  const productIds = new Set<string>();
  for (const [variantId, qty] of [...merged.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const line = ordered.get(variantId);
    if (!line || qty > line.qty - (alreadyBack.get(variantId) ?? 0)) {
      throw new RefundAbort({
        ok: false,
        code: "invalid_restock",
        message: "You can only restock units of this order that have not been restocked yet.",
      });
    }
    await adjustStock({ variantId, delta: qty, reason, actorId: input.actorId, orderId: order.id, note: `Refund restock (${order.ref})` }, tx);
    if (line.productId) productIds.add(line.productId);
  }
  await addOrderEvent(tx, order.id, {
    type: "stock_restocked",
    note: `Restocked ${[...merged.values()].reduce((a, b) => a + b, 0)} unit(s).`,
    actorId: input.actorId,
  });
  return [...productIds];
}
