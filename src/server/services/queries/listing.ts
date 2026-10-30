import { toCard, type CatalogIndex, type IndexedProduct } from "./catalog-index";
import type { FacetCount, Facets, ListProductsParams, ProductListResult } from "./types";

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 60;

type Filters = Pick<
  ListProductsParams,
  "vibes" | "types" | "priceMinPaise" | "priceMaxPaise" | "inStockOnly" | "madeIn"
>;

type Dimension = "vibes" | "types" | "price" | "madeIn";

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function matches(p: IndexedProduct, f: Filters, skip?: Dimension): boolean {
  if (f.inStockOnly && !p.inStock) return false;
  if (skip !== "vibes" && f.vibes?.length) {
    const want = new Set(f.vibes.map(norm));
    if (!p.vibeSlugs.some((v) => want.has(v))) return false;
  }
  if (skip !== "types" && f.types?.length) {
    const want = new Set(f.types.map(norm));
    if (!want.has(p.typeSlug)) return false;
  }
  if (skip !== "price") {
    if (f.priceMinPaise !== undefined && p.priceFromPaise < f.priceMinPaise) return false;
    if (f.priceMaxPaise !== undefined && p.priceFromPaise > f.priceMaxPaise) return false;
  }
  if (skip !== "madeIn" && f.madeIn?.length) {
    const want = new Set(f.madeIn.map(norm));
    if (!p.countryOfOrigin || !want.has(norm(p.countryOfOrigin))) return false;
  }
  return true;
}

const byNewest = (a: IndexedProduct, b: IndexedProduct) =>
  b.createdAt.getTime() - a.createdAt.getTime() || a.slug.localeCompare(b.slug);

function rankIn(p: IndexedProduct, vibe: string): number {
  return p.vibeRanks.get(vibe) ?? Number.POSITIVE_INFINITY;
}

/** Featured-rank order within one vibe (unranked last), then newest. */
export function compareFeatured(vibe: string) {
  return (a: IndexedProduct, b: IndexedProduct) => {
    const ra = rankIn(a, vibe);
    const rb = rankIn(b, vibe);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return byNewest(a, b);
  };
}

export { byNewest as compareNewest };

export interface ListingOptions {
  /**
   * Relevance scores (search). When given, the result set is limited to these ids and the
   * "relevance" ordering sorts by score descending.
   */
  relevance?: ReadonlyMap<string, number>;
}

export type ListingSort = NonNullable<ListProductsParams["sort"]> | "relevance";

/** Pure: filter, facet, sort and page an in-memory catalogue index. */
export function runListing(
  index: CatalogIndex,
  params: Omit<ListProductsParams, "sort"> & { sort?: ListingSort },
  opts: ListingOptions = {},
): ProductListResult {
  const pageSize = clampInt(params.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const page = clampInt(params.page ?? 1, 1, 100_000);
  const finite = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? n : undefined);
  const filters: Filters = {
    ...params,
    priceMinPaise: finite(params.priceMinPaise),
    priceMaxPaise: finite(params.priceMaxPaise),
  };

  const universe = opts.relevance
    ? index.products.filter((p) => opts.relevance!.has(p.id))
    : index.products;
  const filtered = universe.filter((p) => matches(p, filters));

  // ---- sort
  const sort = params.sort ?? (opts.relevance ? "relevance" : "featured");
  const singleVibe = params.vibes?.length === 1 ? norm(params.vibes[0]!) : undefined;
  const vibeContext = params.featuredForVibe ? norm(params.featuredForVibe) : singleVibe;
  const sorted = filtered.slice();
  if (sort === "relevance" || (opts.relevance && sort === "featured")) {
    const rel = opts.relevance;
    sorted.sort(
      (a, b) =>
        (rel?.get(b.id) ?? 0) - (rel?.get(a.id) ?? 0) ||
        a.name.localeCompare(b.name) ||
        a.slug.localeCompare(b.slug),
    );
  } else if (sort === "price_asc") {
    sorted.sort((a, b) => a.priceFromPaise - b.priceFromPaise || byNewest(a, b));
  } else if (sort === "price_desc") {
    sorted.sort((a, b) => b.priceFromPaise - a.priceFromPaise || byNewest(a, b));
  } else if (sort === "newest") {
    sorted.sort(byNewest);
  } else {
    sorted.sort(vibeContext ? compareFeatured(vibeContext) : byNewest);
  }

  const start = (page - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize).map(toCard);

  return {
    items,
    total: sorted.length,
    page,
    pageSize,
    hasMore: start + items.length < sorted.length,
    facets: computeFacets(index, universe, filters),
  };
}

function computeFacets(
  index: CatalogIndex,
  universe: readonly IndexedProduct[],
  f: Filters,
): Facets {
  const vibeCounts = new Map<string, number>();
  for (const p of universe) {
    if (!matches(p, f, "vibes")) continue;
    for (const v of p.vibeSlugs) vibeCounts.set(v, (vibeCounts.get(v) ?? 0) + 1);
  }
  const typeCounts = new Map<string, number>();
  for (const p of universe) {
    if (!matches(p, f, "types")) continue;
    typeCounts.set(p.typeSlug, (typeCounts.get(p.typeSlug) ?? 0) + 1);
  }
  const countryCounts = new Map<string, { label: string; count: number }>();
  for (const p of universe) {
    if (!matches(p, f, "madeIn") || !p.countryOfOrigin) continue;
    const key = norm(p.countryOfOrigin);
    const cur = countryCounts.get(key);
    if (cur) cur.count += 1;
    else countryCounts.set(key, { label: p.countryOfOrigin.trim(), count: 1 });
  }
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const p of universe) {
    if (!matches(p, f, "price")) continue;
    min = Math.min(min, p.priceFromPaise);
    max = Math.max(max, p.priceFromPaise);
  }

  const selectedVibes = new Set((f.vibes ?? []).map(norm));
  const selectedTypes = new Set((f.types ?? []).map(norm));
  const selectedCountries = new Set((f.madeIn ?? []).map(norm));

  const vibes: FacetCount[] = index.vibes
    .map((v) => ({ slug: v.slug, name: v.name, count: vibeCounts.get(v.slug) ?? 0 }))
    .filter((v) => v.count > 0 || selectedVibes.has(v.slug));
  const types: FacetCount[] = index.types
    .map((t) => ({ slug: t.slug, name: t.name, count: typeCounts.get(t.slug) ?? 0 }))
    .filter((t) => t.count > 0 || selectedTypes.has(t.slug));
  const madeIn = [...countryCounts.entries()]
    .map(([, v]) => ({ country: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
  for (const sel of selectedCountries) {
    if (!madeIn.some((m) => norm(m.country) === sel)) madeIn.push({ country: sel, count: 0 });
  }

  return {
    vibes,
    types,
    priceRange: { min: Number.isFinite(min) ? min : 0, max },
    madeIn,
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  const v = Number.isFinite(n) ? Math.floor(n) : lo;
  return Math.min(hi, Math.max(lo, v));
}
