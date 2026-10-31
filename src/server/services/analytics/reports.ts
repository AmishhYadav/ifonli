import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { COUNTED_STATUSES, UNCOUNTED_PAYMENT } from "@/server/services/admin/dashboard";
import type { DbClient } from "@/server/services/queries/shared";

import { fillBuckets, rangeBounds, type Bucket, type DateRange } from "./dates";
import { FUNNEL_STAGES, buildFunnel, type FunnelCounts, type FunnelStep } from "./funnel";

/**
 * Admin report queries (plan 11). All ranges are inclusive India days. "Sales" use the same rule as the
 * dashboard: confirmed or later, not cancelled, not refunded, COD not failed; revenue is the order total
 * (items, shipping and COD fee, after discounts, tax included). Funnel and insight data come from the
 * first-party event tables instead.
 */

const num = (v: unknown): number => Number(v ?? 0);

const list = (values: readonly string[]): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** SQL predicate for orders that count as sales, over the table alias `o`. */
function countedOrders(): SQL {
  return sql`o.status IN (${list(COUNTED_STATUSES)}) AND o.payment_status NOT IN (${list(UNCOUNTED_PAYMENT)})`;
}

function placedIn(range: DateRange): SQL {
  const { start, end } = rangeBounds(range);
  return sql`o.placed_at >= ${start.toISOString()}::timestamptz AND o.placed_at < ${end.toISOString()}::timestamptz`;
}

/* -------------------------------------------------------------------------- */
/* Sales                                                                      */
/* -------------------------------------------------------------------------- */

export interface SalesPoint {
  /** Day ("2026-11-01") or the Monday of the week. */
  bucket: string;
  orders: number;
  revenuePaise: number;
  discountPaise: number;
  aovPaise: number | null;
}

export interface SalesReport {
  bucket: Bucket;
  points: SalesPoint[];
  totals: { orders: number; revenuePaise: number; discountPaise: number; aovPaise: number | null };
}

export async function getSalesReport(db: DbClient, range: DateRange, bucket: Bucket): Promise<SalesReport> {
  const key =
    bucket === "day"
      ? sql`to_char(timezone('Asia/Kolkata', o.placed_at), 'YYYY-MM-DD')`
      : sql`to_char(date_trunc('week', timezone('Asia/Kolkata', o.placed_at)), 'YYYY-MM-DD')`;
  const rows = await db.execute<{ bucket: string; orders: number; revenue: number; discount: number }>(sql`
    SELECT ${key} AS bucket,
           count(*)::int AS orders,
           COALESCE(sum(o.total_paise), 0)::float8 AS revenue,
           COALESCE(sum(o.discount_paise), 0)::float8 AS discount
    FROM orders o
    WHERE ${countedOrders()} AND ${placedIn(range)}
    GROUP BY 1
  `);
  const aov = (orders: number, revenue: number) => (orders > 0 ? Math.round(revenue / orders) : null);
  const points = fillBuckets<SalesPoint>(
    range,
    bucket,
    rows.map((r) => ({
      bucket: r.bucket,
      orders: num(r.orders),
      revenuePaise: num(r.revenue),
      discountPaise: num(r.discount),
      aovPaise: aov(num(r.orders), num(r.revenue)),
    })),
    (b) => ({ bucket: b, orders: 0, revenuePaise: 0, discountPaise: 0, aovPaise: null }),
  );
  const orders = points.reduce((n, p) => n + p.orders, 0);
  const revenuePaise = points.reduce((n, p) => n + p.revenuePaise, 0);
  const discountPaise = points.reduce((n, p) => n + p.discountPaise, 0);
  return { bucket, points, totals: { orders, revenuePaise, discountPaise, aovPaise: aov(orders, revenuePaise) } };
}

/* -------------------------------------------------------------------------- */
/* Orders by status                                                           */
/* -------------------------------------------------------------------------- */

export interface StatusRow {
  status: string;
  orders: number;
  valuePaise: number;
}

export interface OrdersByStatus {
  byStatus: StatusRow[];
  byMethod: StatusRow[];
  byPayment: StatusRow[];
}

/** Every order placed in the range (not only sales), so cancellations and abandoned payments show up. */
export async function getOrdersByStatus(db: DbClient, range: DateRange): Promise<OrdersByStatus> {
  const group = async (column: "status" | "payment_method" | "payment_status"): Promise<StatusRow[]> => {
    const rows = await db.execute<{ k: string; orders: number; value: number }>(sql`
      SELECT o.${sql.raw(column)}::text AS k, count(*)::int AS orders, COALESCE(sum(o.total_paise), 0)::float8 AS value
      FROM orders o
      WHERE ${placedIn(range)}
      GROUP BY 1
      ORDER BY 2 DESC, 1
    `);
    return rows.map((r) => ({ status: r.k, orders: num(r.orders), valuePaise: num(r.value) }));
  };
  const [byStatus, byMethod, byPayment] = await Promise.all([
    group("status"),
    group("payment_method"),
    group("payment_status"),
  ]);
  return { byStatus, byMethod, byPayment };
}

/* -------------------------------------------------------------------------- */
/* Top products / vibes / types                                               */
/* -------------------------------------------------------------------------- */

export interface TopRow {
  key: string;
  name: string;
  /** Orders containing it. */
  orders: number;
  units: number;
  revenuePaise: number;
}

const TOP_LIMIT = 20;

export async function getTopProducts(db: DbClient, range: DateRange, limit = TOP_LIMIT): Promise<TopRow[]> {
  const rows = await db.execute<{ k: string | null; name: string; orders: number; units: number; revenue: number }>(sql`
    SELECT oi.product_id::text AS k, max(oi.product_name) AS name,
           count(DISTINCT o.id)::int AS orders, sum(oi.qty)::int AS units,
           sum(oi.line_total_paise)::float8 AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE ${countedOrders()} AND ${placedIn(range)}
    GROUP BY oi.product_id
    ORDER BY revenue DESC, units DESC, name
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    key: r.k ?? "deleted",
    name: r.k ? r.name : `${r.name} (removed product)`,
    orders: num(r.orders),
    units: num(r.units),
    revenuePaise: num(r.revenue),
  }));
}

/** A product in several vibes counts towards each of them, so vibe totals can add up to more than the sales total. */
export async function getTopVibes(db: DbClient, range: DateRange): Promise<TopRow[]> {
  const rows = await db.execute<{ k: string; name: string; orders: number; units: number; revenue: number }>(sql`
    SELECT v.slug AS k, v.name AS name, count(DISTINCT o.id)::int AS orders,
           sum(oi.qty)::int AS units, sum(oi.line_total_paise)::float8 AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN product_vibes pv ON pv.product_id = oi.product_id
    JOIN vibes v ON v.id = pv.vibe_id
    WHERE ${countedOrders()} AND ${placedIn(range)}
    GROUP BY v.slug, v.name, v.sort
    ORDER BY revenue DESC, v.sort
  `);
  return rows.map((r) => ({ key: r.k, name: r.name, orders: num(r.orders), units: num(r.units), revenuePaise: num(r.revenue) }));
}

export async function getTopTypes(db: DbClient, range: DateRange): Promise<TopRow[]> {
  const rows = await db.execute<{ k: string; name: string; orders: number; units: number; revenue: number }>(sql`
    SELECT t.slug AS k, t.name AS name, count(DISTINCT o.id)::int AS orders,
           sum(oi.qty)::int AS units, sum(oi.line_total_paise)::float8 AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    JOIN product_types t ON t.id = p.type_id
    WHERE ${countedOrders()} AND ${placedIn(range)}
    GROUP BY t.slug, t.name, t.sort
    ORDER BY revenue DESC, t.sort
  `);
  return rows.map((r) => ({ key: r.k, name: r.name, orders: num(r.orders), units: num(r.units), revenuePaise: num(r.revenue) }));
}

/* -------------------------------------------------------------------------- */
/* Coupons                                                                    */
/* -------------------------------------------------------------------------- */

export interface CouponRow {
  code: string;
  orders: number;
  discountPaise: number;
  /** Items value before the discount. */
  subtotalPaise: number;
  /** Order totals paid with the code. */
  revenuePaise: number;
  /** discount / subtotal, 0..1. */
  discountRate: number | null;
}

export async function getCouponPerformance(db: DbClient, range: DateRange): Promise<CouponRow[]> {
  const rows = await db.execute<{ code: string; orders: number; discount: number; subtotal: number; revenue: number }>(sql`
    SELECT upper(o.coupon_code) AS code, count(*)::int AS orders,
           COALESCE(sum(o.discount_paise), 0)::float8 AS discount,
           COALESCE(sum(o.subtotal_paise), 0)::float8 AS subtotal,
           COALESCE(sum(o.total_paise), 0)::float8 AS revenue
    FROM orders o
    WHERE o.coupon_code IS NOT NULL AND ${countedOrders()} AND ${placedIn(range)}
    GROUP BY upper(o.coupon_code)
    ORDER BY orders DESC, discount DESC, code
  `);
  return rows.map((r) => ({
    code: r.code,
    orders: num(r.orders),
    discountPaise: num(r.discount),
    subtotalPaise: num(r.subtotal),
    revenuePaise: num(r.revenue),
    discountRate: num(r.subtotal) > 0 ? num(r.discount) / num(r.subtotal) : null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Funnel                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Sessions -> product page -> add to cart -> checkout -> purchase, from first-party events. Stages are
 * nested per session (see `buildFunnel`). Orders from visitors we could not link to a visit (for example
 * with the beacon blocked) are real sales but cannot appear here.
 */
export async function getFunnel(db: DbClient, range: DateRange): Promise<FunnelStep[]> {
  const { start, end } = rangeBounds(range);
  const flags = FUNNEL_STAGES.map((s, i) => sql`bool_or(event = ${s.event}) AS ${sql.raw(`s${i}`)}`);
  const nested = FUNNEL_STAGES.map((s, i) => {
    const all = Array.from({ length: i + 1 }, (_, n) => sql.raw(`s${n}`));
    return sql`(count(*) FILTER (WHERE ${sql.join(all, sql` AND `)}))::int AS ${sql.raw(s.key)}`;
  });
  const [row] = await db.execute<Record<string, number>>(sql`
    SELECT ${sql.join(nested, sql`, `)}
    FROM (
      SELECT session_id, ${sql.join(flags, sql`, `)}
      FROM analytics_events
      WHERE ts >= ${start.toISOString()}::timestamptz AND ts < ${end.toISOString()}::timestamptz
        AND event IN (${list(FUNNEL_STAGES.map((s) => s.event))})
      GROUP BY session_id
    ) per_session
  `);
  const counts = Object.fromEntries(FUNNEL_STAGES.map((s) => [s.key, num(row?.[s.key])])) as FunnelCounts;
  return buildFunnel(counts);
}
