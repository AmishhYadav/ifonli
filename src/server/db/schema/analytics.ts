import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { pk, timestamps } from "./_common";
import { products } from "./catalog";

/**
 * First-party anonymous events. `product_id` is deliberately NOT a foreign key: an append-only,
 * high-write table should not take FK locks, and history must survive product deletion.
 * No PII, no payment identifiers.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: pk(),
    sessionId: text("session_id").notNull(),
    event: text("event").notNull(),
    productId: uuid("product_id"),
    vibe: text("vibe"),
    path: text("path"),
    value: integer("value"),
    meta: jsonb("meta"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("analytics_events_event_ts_idx").on(t.event, t.ts),
    index("analytics_events_product_ts_idx").on(t.productId, t.ts),
    index("analytics_events_session_idx").on(t.sessionId, t.ts),
    index("analytics_events_ts_idx").on(t.ts),
  ],
).enableRLS();

/**
 * Hourly rollup of `analytics_events` (plus `order_items` for sales), one row per product per day
 * (Asia/Kolkata calendar day). The rollup cron recomputes whole days, so it is idempotent. `purchases`
 * counts orders containing the product; `revenue_paise` is the sum of their line totals.
 */
export const productEngagementDaily = pgTable(
  "product_engagement_daily",
  {
    id: pk(),
    date: date("date", { mode: "string" }).notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    impressions: integer("impressions").notNull().default(0),
    pdpViews: integer("pdp_views").notNull().default(0),
    uniqueViewers: integer("unique_viewers").notNull().default(0),
    avgScrollDepth: real("avg_scroll_depth").notNull().default(0),
    reached75Pct: integer("reached_75_pct").notNull().default(0),
    addToCarts: integer("add_to_carts").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    purchases: integer("purchases").notNull().default(0),
    revenuePaise: bigint("revenue_paise", { mode: "number" }).notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("product_engagement_daily_date_product_uq").on(t.date, t.productId),
    index("product_engagement_daily_product_idx").on(t.productId, t.date),
    check(
      "product_engagement_daily_counts_nonneg",
      sql`${t.impressions} >= 0 AND ${t.pdpViews} >= 0 AND ${t.uniqueViewers} >= 0 AND ${t.reached75Pct} >= 0 AND ${t.addToCarts} >= 0 AND ${t.clicks} >= 0 AND ${t.purchases} >= 0 AND ${t.revenuePaise} >= 0`,
    ),
  ],
).enableRLS();
