/**
 * Insight rules (pure): which products look under-performing compared with the rest of the catalogue.
 * Every rule needs a minimum sample (so three views never raise a flag) and compares a product with the
 * catalogue-wide rate rather than a fixed number, so the same rules work for a tiny and a busy shop.
 */
export interface ProductEngagement {
  productId: string;
  name: string;
  slug: string;
  impressions: number;
  clicks: number;
  pdpViews: number;
  uniqueViewers: number;
  /** Mean deepest scroll milestone (0..100) of visitors who scrolled. */
  avgScrollDepth: number;
  reached75Pct: number;
  addToCarts: number;
  purchases: number;
  revenuePaise: number;
}

export interface InsightThresholds {
  minImpressions: number;
  minPdpViews: number;
  minAddToCarts: number;
  /** Flag a product whose rate is below this fraction of the catalogue rate. */
  lowFactor: number;
}

export const DEFAULT_THRESHOLDS: InsightThresholds = {
  minImpressions: 100,
  minPdpViews: 30,
  minAddToCarts: 10,
  lowFactor: 0.5,
};

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/** Listing click-through rate: clicks / impressions. */
export const ctr = (r: Pick<ProductEngagement, "clicks" | "impressions">) => ratio(r.clicks, r.impressions);
/** Add-to-cart rate: add to carts / product page views. */
export const addToCartRate = (r: Pick<ProductEngagement, "addToCarts" | "pdpViews">) =>
  ratio(r.addToCarts, r.pdpViews);
/** Orders per add to cart. */
export const purchaseRate = (r: Pick<ProductEngagement, "purchases" | "addToCarts">) =>
  ratio(r.purchases, r.addToCarts);
/** Share of product viewers who scrolled to at least 75% of the page. */
export const reached75Rate = (r: Pick<ProductEngagement, "reached75Pct" | "uniqueViewers">) =>
  ratio(r.reached75Pct, r.uniqueViewers);

export interface Benchmarks {
  ctr: number | null;
  addToCartRate: number | null;
  purchaseRate: number | null;
}

/** Catalogue-wide rates: totals over totals (not an average of per-product rates). */
export function benchmarks(rows: readonly ProductEngagement[]): Benchmarks {
  const t = rows.reduce(
    (a, r) => ({
      impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks,
      pdpViews: a.pdpViews + r.pdpViews,
      addToCarts: a.addToCarts + r.addToCarts,
      purchases: a.purchases + r.purchases,
    }),
    { impressions: 0, clicks: 0, pdpViews: 0, addToCarts: 0, purchases: 0 },
  );
  return { ctr: ctr(t), addToCartRate: addToCartRate(t), purchaseRate: purchaseRate(t) };
}

export type InsightKind = "low_ctr" | "low_add_to_cart" | "low_purchase";

export interface Insight {
  kind: InsightKind;
  productId: string;
  name: string;
  slug: string;
  /** The product's rate (0..1). */
  rate: number;
  /** The catalogue rate it was compared with (0..1). */
  benchmark: number;
  /** The count the rate is based on (impressions, views or add to carts). */
  sample: number;
  /** How many clicks / carts / orders it would have had at the catalogue rate, minus what it got. Sort key. */
  missed: number;
  title: string;
  hint: string;
}

const KIND_COPY: Record<InsightKind, { title: string; hint: string }> = {
  low_ctr: {
    title: "Seen often, rarely opened",
    hint: "Try a clearer photo or cutout, a sharper name, or a better position in the vibe.",
  },
  low_add_to_cart: {
    title: "Viewed often, rarely added to cart",
    hint: "Check the price, MRP, stock and variants, the description and the delivery or return notes.",
  },
  low_purchase: {
    title: "Added to cart, rarely bought",
    hint: "Look at shipping cost, COD availability and stock at checkout for this item.",
  },
};

/** Products whose rate is far below the catalogue rate, biggest missed opportunity first. */
export function findInsights(
  rows: readonly ProductEngagement[],
  thresholds: InsightThresholds = DEFAULT_THRESHOLDS,
): Insight[] {
  const bench = benchmarks(rows);
  const out: Insight[] = [];
  const push = (
    kind: InsightKind,
    r: ProductEngagement,
    rate: number,
    benchmark: number,
    sample: number,
  ) => {
    out.push({
      kind,
      productId: r.productId,
      name: r.name,
      slug: r.slug,
      rate,
      benchmark,
      sample,
      missed: Math.max(0, benchmark * sample - rate * sample),
      ...KIND_COPY[kind],
    });
  };

  for (const r of rows) {
    const c = ctr(r);
    if (bench.ctr && bench.ctr > 0 && c !== null && r.impressions >= thresholds.minImpressions && c < bench.ctr * thresholds.lowFactor) {
      push("low_ctr", r, c, bench.ctr, r.impressions);
    }
    const a = addToCartRate(r);
    if (
      bench.addToCartRate &&
      bench.addToCartRate > 0 &&
      a !== null &&
      r.pdpViews >= thresholds.minPdpViews &&
      a < bench.addToCartRate * thresholds.lowFactor
    ) {
      push("low_add_to_cart", r, a, bench.addToCartRate, r.pdpViews);
    }
    const p = purchaseRate(r);
    if (
      bench.purchaseRate &&
      bench.purchaseRate > 0 &&
      p !== null &&
      r.addToCarts >= thresholds.minAddToCarts &&
      p < bench.purchaseRate * thresholds.lowFactor
    ) {
      push("low_purchase", r, p, bench.purchaseRate, r.addToCarts);
    }
  }
  return out.sort((x, y) => y.missed - x.missed || x.name.localeCompare(y.name));
}
