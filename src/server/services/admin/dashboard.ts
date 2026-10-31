import "server-only";

import { and, asc, count, desc, eq, gte, inArray, lt, notInArray, or, sql } from "drizzle-orm";

import {
  adminAuditLog,
  orderEvents,
  orders,
  payments,
  products,
  refunds,
  supportCases,
  user,
} from "@/server/db/schema";
import { istDateString, type FulfillmentStatus, type OrderStatus, type PaymentMethod, type PaymentStatus } from "@/server/domain";
import { listLowStock } from "@/server/services/inventory";
import type { DbClient } from "@/server/services/queries/shared";

export interface SalesWindow {
  orders: number;
  /** Gross order value of non-cancelled orders: paid online plus COD placed. */
  revenuePaise: number;
}

export interface DashboardAnomaly {
  kind: "duplicate_payment" | "late_capture_refund" | "refund_pending" | "refund_failed";
  orderId: string;
  ref: string;
  amountPaise: number;
  at: Date;
}

export interface DashboardStats {
  products: { active: number; draft: number; archived: number };
  lowStock: number;
  outOfStock: number;
  sales: {
    today: SalesWindow;
    /** Today and the six days before it (IST). */
    week: SalesWindow;
    /** Average order value over `week`, or null with no orders. */
    aovPaise: number | null;
  };
  awaitingFulfilment: { total: number; unfulfilled: number; packed: number };
  openSupportCases: number;
  anomalies: {
    /** Captured payments that were not the order's payment and are still waiting for their refund. */
    duplicateOrLate: number;
    pendingRefunds: number;
    failedRefunds: number;
    /** Late payments (after the reservation expired) that were still confirmed in the last 7 days. */
    lateConfirmed7d: number;
    items: DashboardAnomaly[];
  };
  recentOrders: {
    id: string;
    ref: string;
    customerName: string;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    fulfillmentStatus: FulfillmentStatus;
    paymentMethod: PaymentMethod;
    totalPaise: number;
    placedAt: Date;
  }[];
  recentActivity: {
    id: string;
    action: string;
    entity: string;
    entityId: string | null;
    actorName: string | null;
    createdAt: Date;
  }[];
}

/** Orders that count as sales: confirmed onwards, not cancelled, not fully refunded, COD not failed. */
const COUNTED_STATUSES: OrderStatus[] = ["confirmed", "processing", "completed"];
const UNCOUNTED_PAYMENT: PaymentStatus[] = ["refunded", "failed"];

/** Midnight (IST) of the calendar day containing `d`. */
function istMidnight(d: Date): Date {
  return new Date(`${istDateString(d)}T00:00:00+05:30`);
}

const num = (v: unknown) => Number(v ?? 0);

export async function getDashboardStats(
  db: DbClient,
  opts: { withActivity: boolean; now?: Date },
): Promise<DashboardStats> {
  const now = opts.now ?? new Date();
  const todayStart = istMidnight(now);
  const weekStart = new Date(todayStart.getTime() - 6 * 86_400_000);
  const lateSince = new Date(now.getTime() - 7 * 86_400_000);
  const stuckBefore = new Date(now.getTime() - 30 * 60_000);

  const [
    statusRows,
    low,
    [sales],
    [awaiting],
    [support],
    outstanding,
    refundRows,
    [late],
    recentOrders,
    activity,
  ] = await Promise.all([
    db.select({ status: products.status, n: count() }).from(products).groupBy(products.status),
    listLowStock(db, { now }),
    db
      .select({
        todayOrders: sql<number>`count(*) filter (where ${orders.placedAt} >= ${todayStart.toISOString()}::timestamptz)::int`,
        todayRevenue: sql<number>`coalesce(sum(${orders.totalPaise}) filter (where ${orders.placedAt} >= ${todayStart.toISOString()}::timestamptz), 0)::float8`,
        weekOrders: sql<number>`count(*)::int`,
        weekRevenue: sql<number>`coalesce(sum(${orders.totalPaise}), 0)::float8`,
      })
      .from(orders)
      .where(
        and(
          gte(orders.placedAt, weekStart),
          inArray(orders.status, COUNTED_STATUSES),
          notInArray(orders.paymentStatus, UNCOUNTED_PAYMENT),
        ),
      ),
    db
      .select({
        total: sql<number>`count(*)::int`,
        unfulfilled: sql<number>`count(*) filter (where ${orders.fulfillmentStatus} = 'unfulfilled')::int`,
        packed: sql<number>`count(*) filter (where ${orders.fulfillmentStatus} = 'packed')::int`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.status, ["confirmed", "processing"]),
          inArray(orders.fulfillmentStatus, ["unfulfilled", "packed"]),
        ),
      ),
    db.select({ n: count() }).from(supportCases).where(inArray(supportCases.status, ["open", "in_progress"])),
    // Captured payments that were refused (duplicate / no stock / order closed) with no processed refund yet.
    db
      .select({
        orderId: orders.id,
        ref: orders.ref,
        amountPaise: payments.amountPaise,
        at: payments.updatedAt,
        disposition: sql<string>`${payments.raw}->>'disposition'`,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(
        and(
          sql`${payments.raw}->>'disposition' in ('duplicate', 'no_stock', 'order_closed')`,
          sql`not exists (select 1 from ${refunds} r where r.payment_id = ${payments.id} and r.status in ('processed', 'manual'))`,
        ),
      )
      .orderBy(desc(payments.updatedAt))
      .limit(20),
    db
      .select({
        orderId: orders.id,
        ref: orders.ref,
        amountPaise: refunds.amountPaise,
        at: refunds.updatedAt,
        status: refunds.status,
      })
      .from(refunds)
      .innerJoin(orders, eq(orders.id, refunds.orderId))
      // A refund still pending after 30 minutes is stuck (the webhook or the sweeper missed it).
      .where(or(eq(refunds.status, "failed"), and(eq(refunds.status, "pending"), lt(refunds.updatedAt, stuckBefore))))
      .orderBy(asc(refunds.updatedAt))
      .limit(20),
    db
      .select({ n: count() })
      .from(orderEvents)
      .where(and(eq(orderEvents.type, "late_payment_confirmed"), gte(orderEvents.createdAt, lateSince))),
    db
      .select({
        id: orders.id,
        ref: orders.ref,
        address: orders.shippingAddress,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        fulfillmentStatus: orders.fulfillmentStatus,
        paymentMethod: orders.paymentMethod,
        totalPaise: orders.totalPaise,
        placedAt: orders.placedAt,
      })
      .from(orders)
      .where(inArray(orders.status, ["confirmed", "processing", "completed", "cancelled"]))
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(8),
    opts.withActivity
      ? db
          .select({
            id: adminAuditLog.id,
            action: adminAuditLog.action,
            entity: adminAuditLog.entity,
            entityId: adminAuditLog.entityId,
            actorName: user.name,
            createdAt: adminAuditLog.createdAt,
          })
          .from(adminAuditLog)
          .leftJoin(user, eq(adminAuditLog.actorId, user.id))
          .orderBy(desc(adminAuditLog.createdAt))
          .limit(8)
      : Promise.resolve([]),
  ]);

  const byStatus = new Map(statusRows.map((r) => [r.status, r.n]));
  const weekOrders = num(sales?.weekOrders);
  const weekRevenue = num(sales?.weekRevenue);

  const items: DashboardAnomaly[] = [
    ...outstanding.map((o) => ({
      kind: (o.disposition === "duplicate" ? "duplicate_payment" : "late_capture_refund") as DashboardAnomaly["kind"],
      orderId: o.orderId,
      ref: o.ref,
      amountPaise: o.amountPaise,
      at: o.at,
    })),
    ...refundRows.map((r) => ({
      kind: (r.status === "failed" ? "refund_failed" : "refund_pending") as DashboardAnomaly["kind"],
      orderId: r.orderId,
      ref: r.ref,
      amountPaise: r.amountPaise,
      at: r.at,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 6);

  return {
    products: {
      active: byStatus.get("active") ?? 0,
      draft: byStatus.get("draft") ?? 0,
      archived: byStatus.get("archived") ?? 0,
    },
    lowStock: low.filter((r) => r.available > 0).length,
    outOfStock: low.filter((r) => r.available <= 0).length,
    sales: {
      today: { orders: num(sales?.todayOrders), revenuePaise: num(sales?.todayRevenue) },
      week: { orders: weekOrders, revenuePaise: weekRevenue },
      aovPaise: weekOrders > 0 ? Math.round(weekRevenue / weekOrders) : null,
    },
    awaitingFulfilment: {
      total: num(awaiting?.total),
      unfulfilled: num(awaiting?.unfulfilled),
      packed: num(awaiting?.packed),
    },
    openSupportCases: support?.n ?? 0,
    anomalies: {
      duplicateOrLate: outstanding.length,
      pendingRefunds: refundRows.filter((r) => r.status === "pending").length,
      failedRefunds: refundRows.filter((r) => r.status === "failed").length,
      lateConfirmed7d: late?.n ?? 0,
      items,
    },
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      ref: o.ref,
      customerName: String((o.address as { name?: unknown } | null)?.name ?? ""),
      status: o.status,
      paymentStatus: o.paymentStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      paymentMethod: o.paymentMethod,
      totalPaise: o.totalPaise,
      placedAt: o.placedAt,
    })),
    recentActivity: activity,
  };
}
