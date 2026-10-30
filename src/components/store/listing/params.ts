import type { ListProductsParams } from "@/server/services/queries/types";

/**
 * Listing URL <-> query model (pure, no server imports at runtime). Shared by /shop, /vibes/[vibe],
 * /types/[type] and /search. Everything read from the URL is normalised to KNOWN values before it reaches
 * a cached wrapper, because arguments are part of the `'use cache'` key (a hostile `?types=a,b,c...` must not
 * mint cache entries). `vibe` is deliberately not a filter param: `?vibe=` is the site theme.
 *
 *   vibes=cute,bold   types=charms   min=100  max=500 (rupees)   stock=1   made=India
 *   sort=featured|newest|price_asc|price_desc|relevance (search)   page=2   q=skull (search)
 */

export const LISTING_SORTS = ["featured", "newest", "price_asc", "price_desc"] as const;
export type ListingSortValue = (typeof LISTING_SORTS)[number];
export type SearchSortValue = ListingSortValue | "relevance";

export const SORT_LABELS: Record<SearchSortValue, string> = {
  featured: "Featured",
  relevance: "Best match",
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
};

export const PAGE_SIZE = 24;
export const MAX_PAGE = 10;
const MAX_PRICE_RUPEES = 1_000_000;
const MAX_LIST_ITEMS = 12;
const MAX_VALUE_LENGTH = 60;

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Slugs and countries that actually exist; anything else in the URL is dropped. */
export interface KnownValues {
  vibes: readonly string[];
  types: readonly string[];
  madeIn: readonly string[];
}

export interface ListingQuery {
  vibes: string[];
  types: string[];
  minRupees: number | null;
  maxRupees: number | null;
  inStock: boolean;
  madeIn: string[];
  sort: SearchSortValue;
  page: number;
}

export interface ParseOptions {
  /** Search page: default sort is relevance and "relevance" is a valid sort. */
  search?: boolean;
}

export function defaultSort(search: boolean | undefined): SearchSortValue {
  return search ? "relevance" : "featured";
}

function values(raw: string | string[] | undefined): string[] {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= MAX_VALUE_LENGTH);
}

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Keep values that exist in `known` (case-insensitive), returned in `known`'s spelling, deduped and ordered. */
function pickKnown(raw: string | string[] | undefined, known: readonly string[]): string[] {
  const wanted = new Set(values(raw).map((v) => v.toLowerCase()));
  return known.filter((k) => wanted.has(k.toLowerCase())).slice(0, MAX_LIST_ITEMS);
}

function rupees(raw: string | string[] | undefined): number | null {
  const text = first(raw)?.trim();
  if (!text || !/^\d{1,7}$/.test(text)) return null;
  const n = Number(text);
  return n >= 0 && n <= MAX_PRICE_RUPEES ? n : null;
}

export function parseListingQuery(
  raw: RawSearchParams,
  known: KnownValues,
  { search = false }: ParseOptions = {},
): ListingQuery {
  let minRupees = rupees(raw.min);
  let maxRupees = rupees(raw.max);
  if (minRupees !== null && maxRupees !== null && minRupees > maxRupees) {
    [minRupees, maxRupees] = [maxRupees, minRupees];
  }
  const sortRaw = first(raw.sort);
  const sorts: readonly string[] = search ? ["relevance", ...LISTING_SORTS] : LISTING_SORTS;
  const sort = (sortRaw && sorts.includes(sortRaw) ? sortRaw : defaultSort(search)) as SearchSortValue;
  const pageRaw = Number.parseInt(first(raw.page) ?? "1", 10);
  const stock = first(raw.stock)?.toLowerCase();
  return {
    vibes: pickKnown(raw.vibes, known.vibes),
    types: pickKnown(raw.types, known.types),
    minRupees,
    maxRupees,
    inStock: stock === "1" || stock === "true" || stock === "on",
    madeIn: pickKnown(raw.made, known.madeIn),
    sort,
    page: Number.isFinite(pageRaw) ? Math.min(Math.max(pageRaw, 1), MAX_PAGE) : 1,
  };
}

/** Collections pin one dimension: /vibes/gothic is always vibes=[gothic], /types/charms always types=[charms]. */
export interface FixedFilters {
  vibe?: string;
  type?: string;
}

/**
 * The argument object for the cached `listProducts` / `searchProducts`. Keys are added in a fixed order and
 * only when set, so equal queries always produce the same cache key.
 */
export function toListProductsParams(
  query: ListingQuery,
  fixed: FixedFilters = {},
  page: number = query.page,
): ListProductsParams {
  const vibes = fixed.vibe ? [fixed.vibe] : query.vibes;
  const types = fixed.type ? [fixed.type] : query.types;
  const params: ListProductsParams = {};
  if (vibes.length > 0) params.vibes = vibes;
  if (types.length > 0) params.types = types;
  if (query.minRupees !== null) params.priceMinPaise = query.minRupees * 100;
  if (query.maxRupees !== null) params.priceMaxPaise = query.maxRupees * 100;
  if (query.inStock) params.inStockOnly = true;
  if (query.madeIn.length > 0) params.madeIn = query.madeIn;
  params.sort = query.sort === "relevance" ? "featured" : query.sort;
  params.page = page;
  params.pageSize = PAGE_SIZE;
  return params;
}

/** How many filters are active (price counts once). The fixed collection dimension is not a filter. */
export function activeFilterCount(query: ListingQuery, fixed: FixedFilters = {}): number {
  return (
    (fixed.vibe ? 0 : query.vibes.length) +
    (fixed.type ? 0 : query.types.length) +
    (query.minRupees !== null || query.maxRupees !== null ? 1 : 0) +
    (query.inStock ? 1 : 0) +
    query.madeIn.length
  );
}

function csv(list: readonly string[]): string {
  return list.map((v) => encodeURIComponent(v)).join(",");
}

/**
 * Canonical href for a query on `basePath` (defaults are omitted; `page` 1 is omitted). `extra.q` is kept for
 * search. Never includes `?vibe`: the theme sync re-adds it on the client.
 */
export function buildListingHref(
  basePath: string,
  query: Partial<ListingQuery>,
  opts: { search?: boolean; q?: string } = {},
): string {
  const parts: string[] = [];
  if (opts.q) parts.push(`q=${encodeURIComponent(opts.q)}`);
  if (query.vibes?.length) parts.push(`vibes=${csv(query.vibes)}`);
  if (query.types?.length) parts.push(`types=${csv(query.types)}`);
  if (query.minRupees != null) parts.push(`min=${query.minRupees}`);
  if (query.maxRupees != null) parts.push(`max=${query.maxRupees}`);
  if (query.inStock) parts.push("stock=1");
  if (query.madeIn?.length) parts.push(`made=${csv(query.madeIn)}`);
  if (query.sort && query.sort !== defaultSort(opts.search)) parts.push(`sort=${query.sort}`);
  if (query.page && query.page > 1) parts.push(`page=${query.page}`);
  return parts.length > 0 ? `${basePath}?${parts.join("&")}` : basePath;
}
