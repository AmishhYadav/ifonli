import "server-only";

import { sql } from "drizzle-orm";

import type { DbClient } from "@/server/services/queries/shared";
import { readSettings } from "@/server/services/queries/shared";

import { addDays, istDayOf, istDayStart, rangeBounds } from "./dates";

/** Events that feed `product_engagement_daily`. Anything else with a product id (wishlist, ...) does not make a row. */
const ROLLED_EVENTS = [
  "product_impression",
  "product_click",
  "pdp_view",
  "pdp_scroll_depth",
  "add_to_cart",
  "purchase_item",
] as const;

export const DEFAULT_ROLLUP_DAYS = 3;
export const MAX_ROLLUP_DAYS = 90;
const DELETE_BATCH = 20_000;
const MAX_DELETE_BATCHES = 25;

/**
 * Recomputes `product_engagement_daily` for one Asia/Kolkata day from the raw events. The day is rebuilt
 * from scratch (delete + insert in one transaction), so running it again, or two runs overlapping, gives
 * the same rows. Only products that still exist get a row. Returns the number of rows written.
 *
 *  - impressions / clicks / add_to_carts: event counts;
 *  - pdp_views: `pdp_view` events; unique_viewers: distinct sessions that viewed the page;
 *  - avg_scroll_depth: mean of each session's deepest milestone (sessions that reached at least 25);
 *  - reached_75_pct: sessions whose deepest milestone is 75 or 100;
 *  - purchases: distinct orders containing the product; revenue_paise: sum of its line totals.
 */
export async function rollupDay(db: DbClient, day: string): Promise<number> {
  const { start, end } = rangeBounds({ from: day, to: day });
  const events = sql.join(
    ROLLED_EVENTS.map((e) => sql`${e}`),
    sql`, `,
  );
  return db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM product_engagement_daily WHERE date = ${day}::date`);
    const written = await tx.execute(sql`
      WITH ev AS (
        SELECT session_id, event, product_id, value, meta
        FROM analytics_events
        WHERE ts >= ${start.toISOString()}::timestamptz
          AND ts < ${end.toISOString()}::timestamptz
          AND product_id IS NOT NULL
          AND event IN (${events})
      ),
      depth AS (
        SELECT product_id, session_id, max(value) AS deepest
        FROM ev WHERE event = 'pdp_scroll_depth'
        GROUP BY product_id, session_id
      ),
      scroll AS (
        SELECT product_id,
               avg(deepest)::real AS avg_depth,
               (count(*) FILTER (WHERE deepest >= 75))::int AS reached75
        FROM depth GROUP BY product_id
      ),
      agg AS (
        SELECT product_id,
               (count(*) FILTER (WHERE event = 'product_impression'))::int AS impressions,
               (count(*) FILTER (WHERE event = 'product_click'))::int AS clicks,
               (count(*) FILTER (WHERE event = 'pdp_view'))::int AS pdp_views,
               (count(DISTINCT session_id) FILTER (WHERE event = 'pdp_view'))::int AS unique_viewers,
               (count(*) FILTER (WHERE event = 'add_to_cart'))::int AS add_to_carts,
               (count(DISTINCT meta->>'orderId') FILTER (WHERE event = 'purchase_item'))::int AS purchases,
               COALESCE(sum(value) FILTER (WHERE event = 'purchase_item'), 0)::bigint AS revenue
        FROM ev GROUP BY product_id
      )
      INSERT INTO product_engagement_daily
        (date, product_id, impressions, clicks, pdp_views, unique_viewers, avg_scroll_depth,
         reached_75_pct, add_to_carts, purchases, revenue_paise)
      SELECT ${day}::date, a.product_id, a.impressions, a.clicks, a.pdp_views, a.unique_viewers,
             COALESCE(s.avg_depth, 0), COALESCE(s.reached75, 0), a.add_to_carts, a.purchases, a.revenue
      FROM agg a
      JOIN products p ON p.id = a.product_id
      LEFT JOIN scroll s ON s.product_id = a.product_id
      ON CONFLICT (date, product_id) DO UPDATE SET
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        pdp_views = EXCLUDED.pdp_views,
        unique_viewers = EXCLUDED.unique_viewers,
        avg_scroll_depth = EXCLUDED.avg_scroll_depth,
        reached_75_pct = EXCLUDED.reached_75_pct,
        add_to_carts = EXCLUDED.add_to_carts,
        purchases = EXCLUDED.purchases,
        revenue_paise = EXCLUDED.revenue_paise,
        updated_at = now()
      RETURNING 1
    `);
    return written.length;
  });
}

/** The instant before which raw events are deleted: `months` calendar months before `now` (day clamped to the month length). */
export function retentionCutoff(now: Date, months: number): Date {
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(now.getUTCDate(), lastDay),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
}

/** Deletes raw events older than `cutoff` in batches (so one run never holds a huge lock). Returns the rows removed. */
export async function deleteEventsBefore(db: DbClient, cutoff: Date): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_DELETE_BATCHES; i++) {
    const res = await db.execute(sql`
      DELETE FROM analytics_events
      WHERE id IN (
        SELECT id FROM analytics_events WHERE ts < ${cutoff.toISOString()}::timestamptz LIMIT ${DELETE_BATCH}
      )
      RETURNING 1
    `);
    total += res.length;
    if (res.length < DELETE_BATCH) break;
  }
  return total;
}

export interface RollupResult {
  days: { day: string; rows: number }[];
  retentionMonths: number;
  eventsDeleted: number;
}

/**
 * The cron job: rebuild the last `days` India days (today included; default 3, so a late or missed run
 * heals itself), then delete raw events past the retention setting (default 13 months). Rollup rows are
 * kept: that is the long-term record. Days that are already past the retention horizon are not rebuilt
 * (their raw events are gone, so a rebuild would erase the rollup).
 */
export async function runAnalyticsRollup(
  db: DbClient,
  opts: { now?: Date; days?: number } = {},
): Promise<RollupResult> {
  const now = opts.now ?? new Date();
  const days = Math.min(MAX_ROLLUP_DAYS, Math.max(1, Math.floor(opts.days ?? DEFAULT_ROLLUP_DAYS)));
  const { event_retention_months } = await readSettings(db, ["event_retention_months"]);
  const retentionMonths = event_retention_months.value;
  const cutoff = retentionCutoff(now, retentionMonths);

  const today = istDayOf(now);
  const out: RollupResult["days"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    if (istDayStart(addDays(day, 1)) <= cutoff) continue;
    out.push({ day, rows: await rollupDay(db, day) });
  }
  const eventsDeleted = await deleteEventsBefore(db, cutoff);
  return { days: out, retentionMonths, eventsDeleted };
}
