import "server-only";

import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";

import { formatINR } from "@/lib/money";
import {
  couponRedemptions,
  coupons,
  orderItems,
  orders,
  payments,
  refunds,
  stockReservations,
} from "@/server/db/schema";
import {
  AmountMismatchError,
  assertAmountMatches,
  assertTransition,
} from "@/server/domain";
import { enqueueAdminAlert, enqueueCustomerNotification } from "@/server/notify/outbox";
import type { PaymentProvider } from "@/server/payments/provider";
import { getPaymentProvider } from "@/server/payments/registry";

import { recordPurchase } from "./analytics/purchase";
import { clearCartForOrder } from "./cart";
import { REDEMPTION_COUNTING, confirmRedemption } from "./coupons";
import { adjustStock } from "./inventory";
import { addOrderEvent } from "./order-events";
import { ensureInvoiceNumber, nextInvoiceNumber } from "./invoice-number";
import { expireOrder } from "./orders";
import type { DbClient } from "./queries/shared";
import { loadVariantStock } from "./queries/stock";
import { dispositionOf, executeRefund, type PaymentDisposition } from "./refunds";

/* ------------------------------------------------------------------------------------------ */
/* Types                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** A payment the provider reports as CAPTURED (verified by fetching it, never taken on trust). */
export interface CapturedPayment {
  providerOrderId: string;
  providerPaymentId: string;
  amountPaise: number;
  method: string | null;
}

export type FinalizeOutcome =
  /** This call confirmed the order. */
  | "finalized"
  /** The order was already paid by this very payment (replay / the other of verify + webhook). */
  | "already_paid"
  /** The payment could not be kept and is being refunded; see `reason`. */
  | "refunded";

export interface FinalizeResult {
  outcome: FinalizeOutcome;
  orderId: string;
  /** `refunded` only. */
  reason?: PaymentDisposition;
  /** The order had expired before the money arrived and was re-confirmed. */
  late: boolean;
  /** Products whose availability changed (for `revalidateStock`). */
  productIds: string[];
}

export class PaymentFlowError extends Error {
  override name = "PaymentFlowError";
  constructor(
    readonly code: "order_not_found" | "unknown_provider_order",
    message: string,
  ) {
    super(message);
  }
}

type OrderRow = typeof orders.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

interface TxResult extends FinalizeResult {
  /** Refund rows to send to the provider after commit. */
  refundIds: string[];
}

/** Non-personal subset of the provider payment that is safe to keep in `payments.raw`. */
function paymentRaw(p: CapturedPayment, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: p.providerPaymentId,
    order_id: p.providerOrderId,
    amount: p.amountPaise,
    currency: "INR",
    method: p.method,
    status: "captured",
    ...extra,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Invoice numbers                                                                            */
/* ------------------------------------------------------------------------------------------ */

export { nextInvoiceNumber };

/* ------------------------------------------------------------------------------------------ */
/* finalizePaidOrder (plan 7.6)                                                               */
/* ------------------------------------------------------------------------------------------ */

/**
 * Confirms an order for a verified, captured payment. ONE transaction, idempotent, and safe to call
 * concurrently from the verify endpoint, the webhook and the reconcile cron (the order row lock
 * serialises them; the loser sees `already_paid`).
 *
 * Lock order: order row, payments rows, variants (by id), invoice counter. `createFromCart` locks the
 * cart, then the order, then the variants, so the two never wait on each other in a cycle. The cart is
 * therefore cleared AFTER commit, not inside the transaction.
 *
 *  - pending_payment, or expired (late capture) with stock: reservations -> converted, stock
 *    decremented through the ledger (`sale`), payment captured, order `confirmed` / `paid`, coupon
 *    confirmed, invoice number, timeline + outbox rows.
 *  - already paid by this payment id: no-op. Paid by a DIFFERENT payment (or the order is cancelled /
 *    COD): the new payment is recorded as a duplicate and refunded in full, with an admin alert.
 *  - expired and the stock is gone: the payment is refunded in full, the customer gets an apology
 *    and the admin an alert; the order stays expired.
 *  Refunds are saved as `pending` rows inside the transaction and sent to the provider after commit;
 *  if that call fails, `retryPendingRefunds` (cron) sends them.
 */
export async function finalizePaidOrder(
  db: DbClient,
  orderId: string,
  payment: CapturedPayment,
  opts: { now?: Date; provider?: PaymentProvider } = {},
): Promise<FinalizeResult> {
  const now = opts.now ?? new Date();
  let result: TxResult;
  try {
    result = await db.transaction((tx) => finalizeInTransaction(tx, orderId, payment, now));
  } catch (e) {
    if (e instanceof AmountMismatchError) await refundAmountMismatch(db, orderId, payment, opts.provider);
    throw e;
  }

  const { refundIds, ...out } = result;
  for (const id of refundIds) {
    // The refund row is already saved; a provider hiccup is retried by the sweeper.
    const r = await executeRefund(db, id, opts.provider ?? getPaymentProvider());
    if (r.status === "error") console.error("auto-refund deferred", { refundId: id, retryable: r.retryable });
  }
  if (out.outcome === "finalized") {
    try {
      await clearCartForOrder(db, orderId);
    } catch (e) {
      console.error("clearCartForOrder failed", e instanceof Error ? e.message : e);
    }
  }
  return out;
}

async function finalizeInTransaction(
  tx: DbClient,
  orderId: string,
  payment: CapturedPayment,
  now: Date,
): Promise<TxResult> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order) throw new PaymentFlowError("order_not_found", "Order not found");
  assertAmountMatches(order.totalPaise, payment.amountPaise);

  const rows = await tx
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(asc(payments.createdAt), asc(payments.id))
    .for("update");
  const byPid = rows.find((r) => r.providerPaymentId === payment.providerPaymentId);
  const byOid = rows.find((r) => r.providerOrderId === payment.providerOrderId);
  if (!byPid && !byOid) {
    throw new PaymentFlowError("unknown_provider_order", "Payment does not belong to a provider order of this order");
  }

  const base = { orderId, late: order.status === "expired", productIds: [] as string[] };

  // Replay of a payment we already took a decision on.
  if (byPid?.status === "captured") {
    const disposition = dispositionOf(byPid);
    if (!disposition) return { ...base, outcome: "already_paid", late: false, refundIds: [] };
    const open = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(and(eq(refunds.paymentId, byPid.id), eq(refunds.status, "pending"), isNull(refunds.providerRefundId)));
    return { ...base, outcome: "refunded", reason: disposition, refundIds: open.map((r) => r.id) };
  }

  const canAccept =
    order.paymentMethod === "razorpay" &&
    order.paidAt === null &&
    (order.status === "pending_payment" || order.status === "expired");
  if (!canAccept) {
    return refuseCapture(tx, order, byPid ?? byOid, payment, order.paidAt ? "duplicate" : "order_closed", now, base.productIds);
  }

  // Stock: the order's own live reservation counts as available to it.
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const need = new Map<string, { qty: number; productId: string | null }>();
  for (const i of items) {
    const prev = need.get(i.variantId);
    need.set(i.variantId, { qty: (prev?.qty ?? 0) + i.qty, productId: prev?.productId ?? i.productId });
  }
  const variantIds = [...need.keys()].sort();
  const productIds = [...new Set([...need.values()].map((n) => n.productId).filter((p): p is string => !!p))];
  const stock = new Map(
    (await loadVariantStock(tx, variantIds, now, { lock: true })).map((s) => [s.variantId, s]),
  );
  const ownLive = await tx
    .select({ variantId: stockReservations.variantId, qty: stockReservations.qty })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.orderId, orderId),
        eq(stockReservations.status, "active"),
        gt(stockReservations.expiresAt, now),
      ),
    );
  const own = new Map<string, number>();
  for (const r of ownLive) own.set(r.variantId, (own.get(r.variantId) ?? 0) + r.qty);
  const short = variantIds.some((v) => {
    const st = stock.get(v);
    return !st || st.available + (own.get(v) ?? 0) < need.get(v)!.qty;
  });
  if (short) {
    if (order.status === "pending_payment") {
      // Stock vanished under a live reservation (should not happen): close the order out too.
      await expireOrder(tx, orderId, { now });
    }
    return refuseCapture(tx, order, byPid ?? byOid, payment, "no_stock", now, productIds);
  }

  // ---- Commit to the sale ----
  for (const v of variantIds) {
    await adjustStock(
      { variantId: v, delta: -need.get(v)!.qty, reason: "sale", actorId: null, orderId, note: "Payment captured" },
      tx,
    );
  }
  await tx
    .update(stockReservations)
    .set({ status: "converted" })
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));

  const target = (byPid ?? byOid)!;
  await tx
    .update(payments)
    .set({
      providerPaymentId: payment.providerPaymentId,
      status: "captured",
      method: payment.method,
      raw: paymentRaw(payment),
    })
    .where(eq(payments.id, target.id));

  assertTransition("status", order.status, "confirmed");
  assertTransition("payment", order.paymentStatus, "paid");
  await tx
    .update(orders)
    .set({ status: "confirmed", paymentStatus: "paid", paidAt: now })
    .where(eq(orders.id, orderId));

  // Coupon: reserved -> confirmed. A late capture finds it already released: the customer has paid
  // the discounted price, so the sale stands, but the redemption comes back under the coupon lock and
  // the limits are re-checked; going over is recorded and the admin is told, never silent.
  if ((await confirmRedemption(tx, orderId)) === 0) {
    await restoreReleasedRedemption(tx, order);
  }

  const late = order.status === "expired";
  await addOrderEvent(tx, orderId, {
    type: "payment_captured",
    from: order.paymentStatus,
    to: "paid",
    note: `Payment of ${formatINR(payment.amountPaise)} received.`,
    visible: true,
  });
  if (late) {
    await addOrderEvent(tx, orderId, {
      type: "late_payment_confirmed",
      note: "Payment arrived after the reservation expired; stock was still available.",
      visible: true,
    });
  }
  await addOrderEvent(tx, orderId, {
    type: "order_confirmed",
    from: order.status,
    to: "confirmed",
    note: "Order confirmed.",
    visible: true,
  });
  await addOrderEvent(tx, orderId, { type: "stock_converted", note: "Reserved stock sold through the ledger." });

  await enqueueCustomerNotification(tx, {
    orderId,
    template: "order_confirmed",
    to: order.email,
    payload: { ref: order.ref, orderId, totalPaise: order.totalPaise, paymentMethod: "razorpay", late },
  });
  await enqueueAdminAlert(tx, {
    orderId,
    template: "new_order",
    payload: { ref: order.ref, orderId, totalPaise: order.totalPaise, paymentMethod: "razorpay", late },
  });

  // Last: the invoice counter row lock is held until commit. The seller / tax data on the invoice is
  // frozen here, at confirmation.
  await ensureInvoiceNumber(tx, orderId, now);

  // Analytics (fail-safe, own savepoint): the sale is recorded in the same transaction as the capture.
  await recordPurchase(tx, orderId, { now });

  return { outcome: "finalized", orderId, late, productIds, refundIds: [] };
}

/**
 * Late capture: puts a released coupon redemption back to `confirmed`. The coupon row is locked so the
 * count and the update are atomic. If the usage limit or the per-customer limit is already used up by
 * other orders, the redemption is restored anyway (the money is in and the discount was part of the
 * price) but the order gets an internal `coupon_over_limit` event and the admin an alert.
 */
async function restoreReleasedRedemption(tx: DbClient, order: OrderRow): Promise<void> {
  const [released] = await tx
    .select()
    .from(couponRedemptions)
    .where(and(eq(couponRedemptions.orderId, order.id), eq(couponRedemptions.status, "released")))
    .limit(1);
  if (!released) return;

  const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, released.couponId)).for("update");
  const others = and(
    eq(couponRedemptions.couponId, released.couponId),
    inArray(couponRedemptions.status, [...REDEMPTION_COUNTING]),
    ne(couponRedemptions.orderId, order.id),
  );
  const [[total], [mine]] = await Promise.all([
    tx.select({ n: sql<number>`count(*)::int` }).from(couponRedemptions).where(others),
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(couponRedemptions)
      .where(and(others, sql`lower(${couponRedemptions.email}) = lower(${released.email})`)),
  ]);

  await tx.update(couponRedemptions).set({ status: "confirmed" }).where(eq(couponRedemptions.id, released.id));

  const overTotal = coupon?.usageLimit != null && (total?.n ?? 0) >= coupon.usageLimit;
  const overCustomer = coupon?.perCustomerLimit != null && (mine?.n ?? 0) >= coupon.perCustomerLimit;
  if (!overTotal && !overCustomer) return;

  const which = overTotal ? "its usage limit" : "its per-customer limit";
  await addOrderEvent(tx, order.id, {
    type: "coupon_over_limit",
    note: `Coupon ${coupon?.code ?? order.couponCode ?? ""} went over ${which}: the payment arrived after the reservation expired and other orders had used the allowance. The sale was kept.`,
  });
  await enqueueAdminAlert(tx, {
    orderId: order.id,
    template: "payment_anomaly",
    payload: {
      kind: "Coupon limit exceeded by a late payment",
      ref: order.ref,
      orderId: order.id,
      amountPaise: order.totalPaise,
    },
  });
}

/**
 * The captured money cannot be kept: record the payment as handled-by-refund, save a full `pending`
 * refund (sent after commit), and tell the admin (and the customer).
 */
async function refuseCapture(
  tx: DbClient,
  order: OrderRow,
  existing: PaymentRow | undefined,
  payment: CapturedPayment,
  reason: PaymentDisposition,
  _now: Date,
  productIds: string[],
  /** Set when the capture is refused because its amount differs from the order total. */
  mismatch = false,
): Promise<TxResult> {
  const raw = paymentRaw(payment, { disposition: reason });
  let row: PaymentRow;
  if (existing && !(existing.status === "captured" && existing.providerPaymentId !== payment.providerPaymentId)) {
    const [updated] = await tx
      .update(payments)
      .set({ providerPaymentId: payment.providerPaymentId, status: "captured", method: payment.method, raw })
      .where(eq(payments.id, existing.id))
      .returning();
    row = updated!;
  } else {
    // A second payment on a provider order that already has one: `provider_order_id` is unique, so
    // the extra payment gets its own row under a derived key.
    const [inserted] = await tx
      .insert(payments)
      .values({
        orderId: order.id,
        providerOrderId: `${payment.providerOrderId}#dup:${payment.providerPaymentId}`,
        providerPaymentId: payment.providerPaymentId,
        amountPaise: payment.amountPaise,
        status: "captured",
        method: payment.method,
        raw,
      })
      .returning();
    row = inserted!;
  }

  const REASONS: Record<PaymentDisposition, string> = {
    duplicate: "Duplicate payment (auto-refund)",
    no_stock: "Payment after the reservation expired and stock sold out (auto-refund)",
    order_closed: "Payment on a closed order (auto-refund)",
  };
  const refundReason = mismatch ? "Captured amount did not match the order total (auto-refund)" : REASONS[reason];
  const [refund] = await tx
    .insert(refunds)
    .values({ orderId: order.id, paymentId: row!.id, amountPaise: payment.amountPaise, reason: refundReason, status: "pending" })
    .returning({ id: refunds.id });

  await addOrderEvent(tx, order.id, {
    type: mismatch ? "payment_amount_mismatch" : `payment_${reason}`,
    note: mismatch
      ? `Captured ${formatINR(payment.amountPaise)} but the order total is ${formatINR(order.totalPaise)}. Not confirmed; the full amount is being refunded.`
      : `${formatINR(payment.amountPaise)} captured and ${
          reason === "no_stock" ? "refunded because the items sold out" : "refunded automatically"
        } (${REASONS[reason]}).`,
    visible: reason === "no_stock",
  });
  await enqueueAdminAlert(tx, {
    orderId: order.id,
    template: "payment_anomaly",
    payload: mismatch
      ? {
          kind: "amount_mismatch",
          ref: order.ref,
          orderId: order.id,
          providerPaymentId: payment.providerPaymentId,
          capturedPaise: payment.amountPaise,
          orderTotalPaise: order.totalPaise,
        }
      : {
          kind: reason,
          ref: order.ref,
          orderId: order.id,
          providerPaymentId: payment.providerPaymentId,
          amountPaise: payment.amountPaise,
        },
  });
  await enqueueCustomerNotification(tx, {
    orderId: order.id,
    template: reason === "no_stock" ? "payment_late_refund" : "refund_initiated",
    to: order.email,
    payload: { ref: order.ref, refundId: refund!.id, amountPaise: payment.amountPaise },
  });

  return {
    outcome: "refunded",
    reason,
    orderId: order.id,
    late: order.status === "expired",
    productIds,
    refundIds: [refund!.id],
  };
}

/**
 * A captured payment whose amount differs from the order total: the order is NOT confirmed and the
 * whole captured amount is refunded (the same mechanism as the no-stock auto-refund), with the admin
 * alert. Idempotent per payment: a repeat (verify + webhook + cron) finds the decision already
 * recorded and only re-sends a refund that has not reached the provider. When the payment cannot be
 * tied to a provider order of this order there is nothing to refund against, so only the alert is
 * written. A payment that already paid the order is left alone.
 */
async function refundAmountMismatch(
  db: DbClient,
  orderId: string,
  payment: CapturedPayment,
  provider?: PaymentProvider,
): Promise<void> {
  let refundIds: string[] = [];
  try {
    const out = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!order) return { refundIds: [] as string[], alertOnly: false };
      const rows = await tx.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(asc(payments.createdAt), asc(payments.id)).for("update");
      const byPid = rows.find((r) => r.providerPaymentId === payment.providerPaymentId);
      const byOid = rows.find((r) => r.providerOrderId === payment.providerOrderId);
      if (byPid?.status === "captured") {
        // Decision already taken: re-send a refund that never reached the provider, nothing else.
        if (!dispositionOf(byPid)) return { refundIds: [] as string[], alertOnly: false };
        const open = await tx
          .select({ id: refunds.id })
          .from(refunds)
          .where(and(eq(refunds.paymentId, byPid.id), eq(refunds.status, "pending"), isNull(refunds.providerRefundId)));
        return { refundIds: open.map((r) => r.id), alertOnly: false };
      }
      if (!byPid && !byOid) return { refundIds: [] as string[], alertOnly: true };
      const r = await refuseCapture(tx, order, byPid ?? byOid, payment, "order_closed", new Date(), [], true);
      return { refundIds: r.refundIds, alertOnly: false };
    });
    refundIds = out.refundIds;
    if (out.alertOnly) await alertAmountMismatch(db, orderId, payment);
  } catch (e) {
    console.error("refundAmountMismatch failed", e instanceof Error ? e.message : e);
    await alertAmountMismatch(db, orderId, payment);
    return;
  }
  for (const id of refundIds) {
    const r = await executeRefund(db, id, provider ?? getPaymentProvider());
    if (r.status === "error") console.error("auto-refund deferred", { refundId: id, retryable: r.retryable });
  }
}

/** A captured payment whose amount differs from the order total: do not confirm, tell the admin. */
async function alertAmountMismatch(db: DbClient, orderId: string, payment: CapturedPayment): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (!order) return;
      await addOrderEvent(tx, orderId, {
        type: "payment_amount_mismatch",
        note: `Captured ${formatINR(payment.amountPaise)} but the order total is ${formatINR(order.totalPaise)}. Not confirmed.`,
      });
      await enqueueAdminAlert(tx, {
        orderId,
        template: "payment_anomaly",
        payload: {
          kind: "amount_mismatch",
          ref: order.ref,
          orderId,
          providerPaymentId: payment.providerPaymentId,
          capturedPaise: payment.amountPaise,
          orderTotalPaise: order.totalPaise,
        },
      });
    });
  } catch (e) {
    console.error("alertAmountMismatch failed", e instanceof Error ? e.message : e);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Failed attempts                                                                            */
/* ------------------------------------------------------------------------------------------ */

export interface PaymentFailureInput {
  providerOrderId: string;
  providerPaymentId: string;
  method?: string | null;
  errorCode?: string | null;
  errorDescription?: string | null;
}

/**
 * Records a failed payment attempt (webhook `payment.failed`): the payments row and the order's
 * `payment_status` become `failed`, a timeline event is written, and the order stays
 * `pending_payment` so the customer can retry on the same provider order. Ignored once the order is
 * paid (a stale failure of an earlier attempt must not undo a success). Idempotent.
 */
export async function recordPaymentFailure(
  db: DbClient,
  input: PaymentFailureInput,
): Promise<{ recorded: boolean; orderId: string | null }> {
  return db.transaction(async (tx) => {
    const [peek] = await tx.select().from(payments).where(eq(payments.providerOrderId, input.providerOrderId));
    if (!peek) return { recorded: false, orderId: null };
    const [order] = await tx.select().from(orders).where(eq(orders.id, peek.orderId)).for("update");
    const [row] = await tx.select().from(payments).where(eq(payments.id, peek.id)).for("update");
    if (!order || !row) return { recorded: false, orderId: null };
    if (order.paidAt || row.status === "captured") return { recorded: false, orderId: order.id };
    if (row.providerPaymentId === input.providerPaymentId && row.status === "failed") {
      return { recorded: false, orderId: order.id };
    }

    await tx
      .update(payments)
      .set({
        providerPaymentId: input.providerPaymentId,
        status: "failed",
        method: input.method ?? row.method,
        raw: {
          id: input.providerPaymentId,
          order_id: input.providerOrderId,
          status: "failed",
          method: input.method ?? null,
          error_code: input.errorCode ?? null,
          error_description: input.errorDescription ?? null,
        },
      })
      .where(eq(payments.id, row.id));
    if (order.status === "pending_payment" && order.paymentStatus === "unpaid") {
      assertTransition("payment", "unpaid", "failed");
      await tx.update(orders).set({ paymentStatus: "failed" }).where(eq(orders.id, order.id));
    }
    await addOrderEvent(tx, order.id, {
      type: "payment_failed",
      note: `Payment attempt failed${input.errorCode ? ` (${input.errorCode})` : ""}. You can retry.`,
      visible: true,
    });
    return { recorded: true, orderId: order.id };
  });
}
