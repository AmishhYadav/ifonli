import "server-only";

import { sql } from "drizzle-orm";

import type { DbClient } from "@/server/services/queries/shared";

import { rangeBounds, type DateRange } from "./dates";
import { findInsights, type Insight, type ProductEngagement } from "./insight-rules";

const num = (v: unknown): number => Number(v ?? 0);

export interface VibeOption {
  slug: string;
  name: string;
}

export interface VibePerformance {
  slug: string;
  name: string;
  impressions: number;
  clicks: number;
  pdpViews: number;
  addToCarts: number;
  purchases: number;
  revenuePaise: number;
  /** Times visitors switched the site to this vibe. */
  switchesTo: number;
}

export interface TermRow {
  term: string;
  searches: number;
  /** Average number of results the searches returned. */
  avgResults: number;
}

export interface HeroTileRow {
  tile: string;
  vibe: string | null;
  clicks: number;
}

export interface InsightsData {
  range: DateRange;
  vibe: string | null;
  vibes: VibeOption[];
  products: ProductEngagement[];
  findings: Insight[];
  totals: {
    impressions: number;
    clicks: number;
    pdpViews: number;
    addToCarts: number;
    purchases: number;
    heroTileClicks: number;
  };
  vibePerformance: VibePerformance[];
  searchesNoResults: TermRow[];
  topSearches: TermRow[];
  heroTiles: HeroTileRow[];
  /** Raw events exist for the range but the rollup has no rows yet (the hourly cron has not run). */
  rollupPending: boolean;
}

const SEARCH_LIMIT = 20;

/**
 * Everything on the Insights screen. Per-product numbers come from `product_engagement_daily` (rebuilt
 * hourly from raw events); vibe switches, hero clicks and searches are counted from raw events, which are
 * kept for the retention period. `vibe` filters products to those filed under that vibe.
 */
export async function getInsights(
  db: DbClient,
  range: DateRange,
  opts: { vibe?: string | null } = {},
): Promise<InsightsData> {
  const { start, end } = rangeBounds(range);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const vibe = opts.vibe || null;

  const vibeFilter = vibe
    ? sql`AND EXISTS (SELECT 1 FROM product_vibes pv JOIN vibes v ON v.id = pv.vibe_id WHERE pv.product_id = d.product_id AND v.slug = ${vibe})`
    : sql``;

  const [vibeRows, productRows, vibePerfRows, switchRows, zeroRows, topRows, heroRows, eventCountRows] =
    await Promise.all([
      db.execute<{ slug: string; name: string }>(sql`SELECT slug, name FROM vibes ORDER BY sort, slug`),
      db.execute<{
        product_id: string;
        name: string;
        slug: string;
        impressions: number;
        clicks: number;
        pdp_views: number;
        unique_viewers: number;
        avg_depth: number;
        reached75: number;
        add_to_carts: number;
        purchases: number;
        revenue: number;
      }>(sql`
        SELECT d.product_id, p.name, p.slug,
               sum(d.impressions)::int AS impressions, sum(d.clicks)::int AS clicks,
               sum(d.pdp_views)::int AS pdp_views, sum(d.unique_viewers)::int AS unique_viewers,
               COALESCE(sum(d.avg_scroll_depth * d.unique_viewers) / NULLIF(sum(d.unique_viewers), 0), 0)::float8 AS avg_depth,
               sum(d.reached_75_pct)::int AS reached75, sum(d.add_to_carts)::int AS add_to_carts,
               sum(d.purchases)::int AS purchases, sum(d.revenue_paise)::float8 AS revenue
        FROM product_engagement_daily d JOIN products p ON p.id = d.product_id
        WHERE d.date >= ${range.from}::date AND d.date <= ${range.to}::date ${vibeFilter}
        GROUP BY d.product_id, p.name, p.slug
        ORDER BY pdp_views DESC, impressions DESC, p.name
      `),
      db.execute<{
        slug: string;
        name: string;
        impressions: number;
        clicks: number;
        pdp_views: number;
        add_to_carts: number;
        purchases: number;
        revenue: number;
      }>(sql`
        SELECT v.slug, v.name,
               COALESCE(sum(d.impressions), 0)::int AS impressions, COALESCE(sum(d.clicks), 0)::int AS clicks,
               COALESCE(sum(d.pdp_views), 0)::int AS pdp_views, COALESCE(sum(d.add_to_carts), 0)::int AS add_to_carts,
               COALESCE(sum(d.purchases), 0)::int AS purchases, COALESCE(sum(d.revenue_paise), 0)::float8 AS revenue
        FROM vibes v
        LEFT JOIN product_vibes pv ON pv.vibe_id = v.id
        LEFT JOIN product_engagement_daily d
               ON d.product_id = pv.product_id AND d.date >= ${range.from}::date AND d.date <= ${range.to}::date
        GROUP BY v.slug, v.name, v.sort
        ORDER BY v.sort, v.slug
      `),
      db.execute<{ vibe: string; n: number }>(sql`
        SELECT vibe, count(*)::int AS n FROM analytics_events
        WHERE event = 'vibe_switch' AND vibe IS NOT NULL
          AND ts >= ${startIso}::timestamptz AND ts < ${endIso}::timestamptz
        GROUP BY vibe
      `),
      db.execute<{ term: string; searches: number; avg_results: number }>(sql`
        SELECT meta->>'q' AS term, count(*)::int AS searches, COALESCE(avg(value), 0)::float8 AS avg_results
        FROM analytics_events
        WHERE event = 'search' AND value = 0 AND meta->>'q' IS NOT NULL
          AND ts >= ${startIso}::timestamptz AND ts < ${endIso}::timestamptz
        GROUP BY 1 ORDER BY searches DESC, term LIMIT ${SEARCH_LIMIT}
      `),
      db.execute<{ term: string; searches: number; avg_results: number }>(sql`
        SELECT meta->>'q' AS term, count(*)::int AS searches, COALESCE(avg(value), 0)::float8 AS avg_results
        FROM analytics_events
        WHERE event = 'search' AND meta->>'q' IS NOT NULL
          AND ts >= ${startIso}::timestamptz AND ts < ${endIso}::timestamptz
        GROUP BY 1 ORDER BY searches DESC, term LIMIT ${SEARCH_LIMIT}
      `),
      db.execute<{ tile: string; vibe: string | null; clicks: number }>(sql`
        SELECT COALESCE(meta->>'tile', 'unknown') AS tile, vibe, count(*)::int AS clicks
        FROM analytics_events
        WHERE event = 'hero_tile_click'
          AND ts >= ${startIso}::timestamptz AND ts < ${endIso}::timestamptz
        GROUP BY 1, 2 ORDER BY clicks DESC, tile LIMIT ${SEARCH_LIMIT}
      `),
      db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM analytics_events
        WHERE event IN ('product_impression', 'pdp_view')
          AND ts >= ${startIso}::timestamptz AND ts < ${endIso}::timestamptz
      `),
    ]);

  const products: ProductEngagement[] = productRows.map((r) => ({
    productId: r.product_id,
    name: r.name,
    slug: r.slug,
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    pdpViews: num(r.pdp_views),
    uniqueViewers: num(r.unique_viewers),
    avgScrollDepth: num(r.avg_depth),
    reached75Pct: num(r.reached75),
    addToCarts: num(r.add_to_carts),
    purchases: num(r.purchases),
    revenuePaise: num(r.revenue),
  }));

  const switches = new Map(switchRows.map((r) => [r.vibe, num(r.n)]));
  const sum = (pick: (p: ProductEngagement) => number) => products.reduce((n, p) => n + pick(p), 0);
  const heroTiles = heroRows.map((r) => ({ tile: r.tile, vibe: r.vibe, clicks: num(r.clicks) }));

  return {
    range,
    vibe,
    vibes: vibeRows.map((v) => ({ slug: v.slug, name: v.name })),
    products,
    findings: findInsights(products),
    totals: {
      impressions: sum((p) => p.impressions),
      clicks: sum((p) => p.clicks),
      pdpViews: sum((p) => p.pdpViews),
      addToCarts: sum((p) => p.addToCarts),
      purchases: sum((p) => p.purchases),
      heroTileClicks: heroTiles.reduce((n, t) => n + t.clicks, 0),
    },
    vibePerformance: vibePerfRows
      .filter((v) => !vibe || v.slug === vibe)
      .map((v) => ({
        slug: v.slug,
        name: v.name,
        impressions: num(v.impressions),
        clicks: num(v.clicks),
        pdpViews: num(v.pdp_views),
        addToCarts: num(v.add_to_carts),
        purchases: num(v.purchases),
        revenuePaise: num(v.revenue),
        switchesTo: switches.get(v.slug) ?? 0,
      })),
    searchesNoResults: zeroRows.map((r) => ({ term: r.term, searches: num(r.searches), avgResults: num(r.avg_results) })),
    topSearches: topRows.map((r) => ({ term: r.term, searches: num(r.searches), avgResults: num(r.avg_results) })),
    heroTiles: vibe ? heroTiles.filter((t) => t.vibe === vibe) : heroTiles,
    rollupPending: products.length === 0 && num(eventCountRows[0]?.n) > 0,
  };
}
