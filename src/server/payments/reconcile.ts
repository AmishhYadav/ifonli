import "server-only";

import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";

import { orderItems, orders, payments } from "@/server/db/schema";
import { AmountMismatchError } from "@/server/domain";
import { finalizePaidOrder, PaymentFlowError } from "@/server/services/payments";
import { expireOrder, releaseExpiredReservations } from "@/server/services/orders";
import type { DbClient } from "@/server/services/queries/shared";
import { dispositionOf, retryPendingRefunds } from "@/server/services/refunds";

import { confirmListedPayment } from "./confirm";
import type { PaymentProvider } from "./provider";

export interface ReconcileStats {
  checked: number;
  finalized: number;
  refunded: number;
  expired: number;
  /** Orders left alone because the provider could not be asked (never expired blind). */
  errors: number;
  /** Products whose availability changed (for `revalidateStock`). */
  productIds: string[];
}

export interface ReconcileOptions {
  now?: Date;
  /** Only look at pending orders at least this old (default 5 min: the customer may still be paying). */
  minAgeMs?: number;
  /** Only orders whose reservation has lapsed. */
  dueOnly?: boolean;
  /** Expire orders that are due and have no captured payment. Default true. */
  expireDue?: boolean;
  limit?: number;
  /** Source of randomness for picking which late-capture candidates to poll (tests inject one). */
  random?: () => number;
}

/** A late capture can still arrive for an expired order; look back this far. */
const LATE_WINDOW_MS = 6 * 60 * 60_000;

/**
 * Cron backstop for lost callbacks (plan 7.6). For every `pending_payment` online order older than
 * `minAgeMs`: list the provider's payments for its provider order(s); a captured (or capturable
 * authorized) one is finalised through the same idempotent path as verify / webhook; if there is
 * none and the reservation has lapsed, the order is expired. If the provider cannot be reached the
 * order is skipped, so a paid order is never expired because of an outage. Recently expired orders
 * are also re-checked for a late capture.
 */
export async function reconcilePayments(
  db: DbClient,
  provider: PaymentProvider,
  opts: ReconcileOptions = {},
): Promise<ReconcileStats> {
  const now = opts.now ?? new Date();
  const minAgeMs = opts.minAgeMs ?? 5 * 60_000;
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const stats: ReconcileStats = { checked: 0, finalized: 0, refunded: 0, expired: 0, errors: 0, productIds: [] };
  const touched = new Set<string>();

  const pendingWhere = [
    eq(orders.status, "pending_payment" as const),
    eq(orders.paymentMethod, "razorpay" as const),
    lte(orders.placedAt, new Date(now.getTime() - minAgeMs)),
    ...(opts.dueOnly ? [lte(orders.expiresAt, now)] : []),
  ];
  const pending = await db
    .select({ id: orders.id, expiresAt: orders.expiresAt })
    .from(orders)
    .where(and(...pendingWhere))
    .orderBy(asc(orders.placedAt))
    .limit(limit);
  // Late captures: every recently expired, unpaid order is a candidate, but only `limit` are asked about
  // per run. Always taking the oldest 50 would poll the same rows forever once more than 50 are
  // waiting, so the window starts at a random place in the list and wraps around.
  let late: { id: string; expiresAt: Date | null }[] = [];
  if (!opts.dueOnly) {
    const candidates = await db
      .select({ id: orders.id, expiresAt: orders.expiresAt })
      .from(orders)
      .where(
        and(
          eq(orders.status, "expired"),
          eq(orders.paymentMethod, "razorpay"),
          isNull(orders.paidAt),
          gt(orders.expiresAt, new Date(now.getTime() - LATE_WINDOW_MS)),
        ),
      )
      .orderBy(asc(orders.expiresAt), asc(orders.id));
    if (candidates.length <= limit) late = candidates;
    else {
      const start = Math.floor((opts.random ?? Math.random)() * candidates.length) % candidates.length;
      late = [...candidates.slice(start), ...candidates.slice(0, start)].slice(0, limit);
    }
  }

  for (const o of [...pending, ...late]) {
    stats.checked += 1;
    const rows = (await db.select().from(payments).where(eq(payments.orderId, o.id))).filter((r) => !dispositionOf(r));
    let providerFailed = false;
    let handled = false;

    for (const row of rows) {
      let listed;
      try {
        listed = await provider.fetchOrderPayments(row.providerOrderId);
      } catch {
        providerFailed = true;
        continue;
      }
      for (const p of listed) {
        if (row.status === "captured" && row.providerPaymentId === p.id) continue; // already booked
        const confirmed = await confirmListedPayment(provider, p);
        if (!confirmed.ok) {
          if (confirmed.reason === "provider_error") providerFailed = true;
          continue;
        }
        try {
          const r = await finalizePaidOrder(db, o.id, confirmed.payment, { now, provider });
          handled = true;
          if (r.outcome === "finalized") stats.finalized += 1;
          else if (r.outcome === "refunded") stats.refunded += 1;
          for (const id of r.productIds) touched.add(id);
        } catch (e) {
          if (!(e instanceof AmountMismatchError) && !(e instanceof PaymentFlowError)) providerFailed = true;
        }
      }
    }

    if (providerFailed) {
      stats.errors += 1;
      continue;
    }
    const due = o.expiresAt !== null && o.expiresAt.getTime() <= now.getTime();
    if (!handled && due && (opts.expireDue ?? true)) {
      const { expired } = await expireOrder(db, o.id, { now });
      if (expired) {
        stats.expired += 1;
        const items = await db.select({ p: orderItems.productId }).from(orderItems).where(eq(orderItems.orderId, o.id));
        for (const i of items) if (i.p) touched.add(i.p);
      }
    }
  }
  stats.productIds = [...touched];
  return stats;
}

/**
 * `release-reservations` cron: reconcile with the provider first (so a paid order is finalised, not
 * expired), then run the plain sweep. The sweep only runs when every due order could be checked.
 */
export async function releaseDueReservations(
  db: DbClient,
  provider: PaymentProvider,
  opts: { now?: Date } = {},
): Promise<ReconcileStats & { swept: number }> {
  const now = opts.now ?? new Date();
  const stats = await reconcilePayments(db, provider, { now, minAgeMs: 0, dueOnly: true, expireDue: true });
  let swept = 0;
  if (stats.errors === 0) swept = (await releaseExpiredReservations(db, now)).expired;
  return { ...stats, swept };
}

/** `reconcile-payments` cron: pending orders, late captures, then stuck refunds. */
export async function reconcileAll(db: DbClient, provider: PaymentProvider, opts: { now?: Date } = {}) {
  const payments_ = await reconcilePayments(db, provider, { now: opts.now });
  const refunds_ = await retryPendingRefunds(db, provider, { now: opts.now });
  return { payments: payments_, refunds: refunds_ };
}
