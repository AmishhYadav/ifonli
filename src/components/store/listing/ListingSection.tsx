import Link from "next/link";
import { connection } from "next/server";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { SearchTracker } from "@/features/analytics";
import { WishlistHeart } from "@/features/wishlist/WishlistHeart";
import { getDb } from "@/server/db";
import { getCollections, listProducts } from "@/server/cache/catalog";
import { searchProducts } from "@/server/services/search";
import { sanitizeSearchQuery } from "@/server/services/queries/shared";
import type { Facets, ProductCard as ProductCardData } from "@/server/services/queries/types";

import { ProductCard } from "../ProductCard";
import { ProductGrid, ProductGridItem } from "../ProductGrid";

import { FilterDrawer } from "./FilterDrawer";
import { ListingFilters, type ListingFacets } from "./ListingFilters";
import { NoResults } from "./NoResults";
import { SortSelect } from "./SortSelect";
import {
  LISTING_SORTS,
  activeFilterCount,
  buildListingHref,
  parseListingQuery,
  toListProductsParams,
  type FixedFilters,
  type KnownValues,
  type ListingQuery,
  type RawSearchParams,
  type SearchSortValue,
} from "./params";

const GRID_SIZES = "(min-width: 1280px) 20vw, (min-width: 1024px) 24vw, (min-width: 768px) 33vw, 50vw";

interface ListingSectionProps {
  basePath: string;
  searchParams: Promise<RawSearchParams>;
  fixed?: FixedFilters;
  mode?: "catalog" | "search";
}

/** Slugs and countries that exist (cached): the whitelist URL params are normalised against. */
async function getKnownValues(): Promise<KnownValues> {
  const [collections, base] = await Promise.all([getCollections(), listProducts({ pageSize: 1 })]);
  return {
    vibes: collections.vibes.map((v) => v.slug),
    types: collections.types.map((t) => t.slug),
    madeIn: base.facets.madeIn.map((m) => m.country),
  };
}

function toFacets(facets: Facets): ListingFacets {
  return {
    vibes: facets.vibes.map((f) => ({ value: f.slug, label: f.name, count: f.count })),
    types: facets.types.map((f) => ({ value: f.slug, label: f.name, count: f.count })),
    madeIn: facets.madeIn.map((f) => ({ value: f.country, label: f.country, count: f.count })),
    priceRange: facets.priceRange,
  };
}

interface Loaded {
  items: ProductCardData[];
  total: number;
  hasMore: boolean;
  facets: Facets;
}

/**
 * Loads pages 1..n (cumulative "Load more": each page is its own cache entry for the catalogue, so
 * `?page=3` is three cached reads, not a new query shape).
 */
async function load(
  query: ListingQuery,
  fixed: FixedFilters,
  search: { q: string } | null,
): Promise<Loaded> {
  const pages = Array.from({ length: query.page }, (_, i) => i + 1);
  const results = await Promise.all(
    pages.map((page) => {
      const params = toListProductsParams(query, fixed, page);
      return search
        ? searchProducts(getDb(), { ...params, q: search.q, sort: query.sort })
        : listProducts(params);
    }),
  );
  const first = results[0]!;
  const last = results[results.length - 1]!;
  const seen = new Set<string>();
  const items = results
    .flatMap((r) => r.items)
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
  return { items, total: first.total, hasMore: last.hasMore, facets: first.facets };
}

function FilterChips({
  query,
  fixed,
  basePath,
  search,
  q,
  names,
}: {
  query: ListingQuery;
  fixed: FixedFilters;
  basePath: string;
  search: boolean;
  q?: string;
  names: Map<string, string>;
}) {
  const chips: { label: string; href: string }[] = [];
  const without = (patch: Partial<ListingQuery>) =>
    buildListingHref(basePath, { ...query, ...patch, page: 1 }, { search, q });
  if (!fixed.vibe) {
    for (const v of query.vibes) {
      chips.push({ label: names.get(v) ?? v, href: without({ vibes: query.vibes.filter((x) => x !== v) }) });
    }
  }
  if (!fixed.type) {
    for (const t of query.types) {
      chips.push({ label: names.get(t) ?? t, href: without({ types: query.types.filter((x) => x !== t) }) });
    }
  }
  if (query.minRupees !== null || query.maxRupees !== null) {
    const label =
      query.minRupees !== null && query.maxRupees !== null
        ? `₹${query.minRupees} to ₹${query.maxRupees}`
        : query.minRupees !== null
          ? `From ₹${query.minRupees}`
          : `Up to ₹${query.maxRupees}`;
    chips.push({ label, href: without({ minRupees: null, maxRupees: null }) });
  }
  if (query.inStock) chips.push({ label: "In stock", href: without({ inStock: false }) });
  for (const m of query.madeIn) {
    chips.push({ label: `Made in ${m}`, href: without({ madeIn: query.madeIn.filter((x) => x !== m) }) });
  }
  if (chips.length === 0) return null;

  const clearAll = buildListingHref(
    basePath,
    { sort: query.sort },
    { search, q },
  );
  return (
    <ul aria-label="Active filters" className="mb-5 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <li key={chip.label}>
          <Link
            href={chip.href}
            scroll={false}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-button bg-surface-2 px-4 text-sm font-semibold text-ink"
            aria-label={`Remove filter: ${chip.label}`}
          >
            {chip.label}
            <Icon name="close" className="size-4" />
          </Link>
        </li>
      ))}
      <li>
        <Link
          href={clearAll}
          scroll={false}
          className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-link underline underline-offset-4"
        >
          Clear all
        </Link>
      </li>
    </ul>
  );
}

/**
 * The filterable product listing shared by /shop, /vibes/[vibe], /types/[type] and /search.
 * Reads `searchParams`, so render it inside `<Suspense>`: the page shell around it stays static.
 */
export async function ListingSection({
  basePath,
  searchParams,
  fixed = {},
  mode = "catalog",
}: ListingSectionProps) {
  const raw = await searchParams;
  const search = mode === "search";
  const known = await getKnownValues();
  const query = parseListingQuery(raw, known, { search });
  const rawQ = Array.isArray(raw.q) ? raw.q[0] : raw.q;
  const q = search ? sanitizeSearchQuery(rawQ) : undefined;

  if (search && !q) {
    return <NoResults variant="prompt" />;
  }
  // Search is never cached: mark the rest as request-time (it reads the clock and the database).
  if (search) await connection();

  const { items, total, hasMore, facets } = await load(query, fixed, search ? { q: q! } : null);
  const listingFacets = toFacets(facets);
  const filterCount = activeFilterCount(query, fixed);
  const names = new Map<string, string>([
    ...listingFacets.vibes.map((o) => [o.value, o.label] as const),
    ...listingFacets.types.map((o) => [o.value, o.label] as const),
  ]);

  // The unfiltered catalogue is empty (nothing in this collection yet), as opposed to "filters match nothing".
  const noFilters = filterCount === 0;
  const sorts: SearchSortValue[] = search ? ["relevance", ...LISTING_SORTS] : [...LISTING_SORTS];
  const sortHrefs = Object.fromEntries(
    sorts.map((sort) => [sort, buildListingHref(basePath, { ...query, sort, page: 1 }, { search, q })]),
  ) as Partial<Record<SearchSortValue, string>>;
  const filterProps = { basePath, q, search, fixed, query, facets: listingFacets };

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-4 sm:px-6">
      {search ? <SearchTracker query={q!} results={total} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline py-4">
        <p role="status" aria-live="polite" className="text-base font-semibold" data-testid="result-count">
          {total} {total === 1 ? "product" : "products"}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <FilterDrawer {...filterProps} activeCount={filterCount} total={total} />
          {total > 1 ? <SortSelect value={query.sort} hrefs={sortHrefs} /> : null}
        </div>
      </div>

      <div className="grid gap-8 pt-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside aria-label="Filters" className="max-lg:hidden">
          <div className="sticky top-24">
            <ListingFilters {...filterProps} />
          </div>
        </aside>

        <div className="min-w-0">
          <FilterChips
            query={query}
            fixed={fixed}
            basePath={basePath}
            search={search}
            q={q}
            names={names}
          />

          {items.length > 0 ? (
            <>
              <ProductGrid data-testid="product-grid">
                {items.map((product, i) => (
                  <ProductGridItem key={product.id}>
                    <ProductCard
                      product={product}
                      eager={i < 4}
                      sizes={GRID_SIZES}
                      wishlist={<WishlistHeart productId={product.id} productName={product.name} />}
                    />
                  </ProductGridItem>
                ))}
              </ProductGrid>
              <div className="mt-10 flex flex-col items-center gap-3">
                {hasMore ? (
                  <p className="text-sm text-ink-muted">
                    Showing {items.length} of {total}
                  </p>
                ) : null}
                {hasMore ? (
                  <Button asChild variant="secondary" size="lg">
                    <Link
                      href={buildListingHref(basePath, { ...query, page: query.page + 1 }, { search, q })}
                      scroll={false}
                      rel="next"
                    >
                      Load more
                    </Link>
                  </Button>
                ) : null}
              </div>
            </>
          ) : search ? (
            <NoResults variant="none" q={q!} />
          ) : (
            <EmptyState
              icon={noFilters ? "package" : "filter"}
              title={noFilters ? "Nothing here yet" : "No products match these filters"}
              action={
                noFilters ? (
                  <Button asChild variant="secondary">
                    <Link href="/shop">Browse everything</Link>
                  </Button>
                ) : (
                  <Button asChild variant="secondary">
                    <Link href={buildListingHref(basePath, { sort: query.sort }, {})} scroll={false}>
                      Clear all filters
                    </Link>
                  </Button>
                )
              }
            >
              {noFilters
                ? "New things land here soon."
                : "Try removing a filter or widening the price range."}
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
