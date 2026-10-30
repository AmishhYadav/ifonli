import "server-only";

import { sql } from "drizzle-orm";

import { loadCatalogIndex, toCard, type CatalogIndex } from "./queries/catalog-index";
import { compareFeatured, compareNewest, runListing } from "./queries/listing";
import { sanitizeSearchQuery, type DbClient } from "./queries/shared";
import type { ListProductsParams, ProductCard, ProductListResult } from "./queries/types";

export { sanitizeSearchQuery } from "./queries/shared";

/** Below this many full-text hits, trigram (typo-tolerant) matches are considered. */
export const FUZZY_FALLBACK_BELOW = 3;
/** `similarity(name, q)` must exceed this ... */
const TRGM_SIMILARITY_MIN = 0.25;
/** Threshold when full-text already found something. */
const TRGM_STRICT_MIN = 0.7;
/**
 * ... or `word_similarity(q, name + type + vibes)` must reach this ("skul" -> "Skull charm").
 * Stricter for very short queries, where 2-3 shared trigrams are mostly noise ("the" ~ "Thought").
 */
function wordSimilarityMin(q: string): number {
  return q.length <= 3 ? 0.8 : q.length === 4 ? 0.7 : 0.5;
}

export type SearchSort = NonNullable<ListProductsParams["sort"]> | "relevance";

export interface SearchParams extends Omit<ListProductsParams, "sort"> {
  q: string;
  /** Default "relevance". "featured" is treated as relevance in search. */
  sort?: SearchSort;
  /** Vibe whose popular products are suggested when nothing matches. */
  fallbackVibe?: string;
}

export interface SearchResult extends ProductListResult {
  /** The sanitised query actually searched. */
  query: string;
  /** True when trigram fuzzy matches were mixed in. */
  usedFuzzy: boolean;
  /** Only filled when `total === 0`: popular products (in `fallbackVibe` if given). */
  suggestions: ProductCard[];
}

type Tier = 1 | 2 | 3;
const TIER = { fuzzy: 1, fts: 2, sku: 3 } as const satisfies Record<string, Tier>;

type MatchRow = { id: string; score: number };

/**
 * Finds product ids matching `q`, with a composite relevance (tier * 100 + score):
 *  - tier 3: SKU prefix match;
 *  - tier 2: full-text. A per-product document = `products.search_tsv` (name A, description C)
 *    || type name (B) || vibe names (B), accent-folded with `immutable_unaccent`, matched with
 *    `websearch_to_tsquery('english', ...)` and ranked with `ts_rank` (+1 for an exact name);
 *    so "gothic", "sticker" and "gothic charm" work through the type/vibe names;
 *  - tier 1: pg_trgm typo tolerance, only when full-text found fewer than
 *    `FUZZY_FALLBACK_BELOW` products.
 * The query text is always a bound parameter; `websearch_to_tsquery` never raises on odd input.
 * Active products with an active type only; variant-level visibility is applied by the index.
 */
export async function findSearchMatches(
  db: DbClient,
  q: string,
): Promise<{ scores: Map<string, number>; usedFuzzy: boolean }> {
  const scores = new Map<string, number>();
  if (!q) return { scores, usedFuzzy: false };

  const fts = await db.execute<MatchRow>(sql`
    WITH query AS (
      SELECT websearch_to_tsquery('english', public.immutable_unaccent(${q}::text)) AS tsq
    ),
    docs AS (
      SELECT p.id, p.name,
        p.search_tsv
          || setweight(to_tsvector('english', public.immutable_unaccent(coalesce(t.name, ''))), 'B')
          || setweight(to_tsvector('english', public.immutable_unaccent(coalesce(
               (SELECT string_agg(v.name, ' ')
                  FROM product_vibes pv JOIN vibes v ON v.id = pv.vibe_id
                 WHERE pv.product_id = p.id), ''))), 'B') AS doc
      FROM products p
      JOIN product_types t ON t.id = p.type_id
      WHERE p.status = 'active' AND t.active
    )
    SELECT d.id::text AS id,
           (ts_rank(d.doc, query.tsq)
             + CASE WHEN lower(d.name) = lower(${q}::text) THEN 1 ELSE 0 END)::float8 AS score
    FROM docs d, query
    WHERE d.doc @@ query.tsq
  `);
  for (const r of fts) scores.set(r.id, TIER.fts * 100 + Number(r.score));

  if (!q.includes(" ") && q.length >= 3) {
    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const skus = await db.execute<{ id: string }>(sql`
      SELECT DISTINCT v.product_id::text AS id
      FROM variants v
      JOIN products p ON p.id = v.product_id
      WHERE p.status = 'active' AND v.active
        AND lower(v.sku) LIKE lower(${escaped}::text) || '%' ESCAPE '\\'
    `);
    for (const r of skus) scores.set(r.id, TIER.sku * 100);
  }

  let usedFuzzy = false;
  if (scores.size < FUZZY_FALLBACK_BELOW) {
    // Nothing found at all: be lenient (typos). Something found already: only add near-matches, so
    // a correct but narrow query ("skull charm") is not padded with every other "charm".
    const strict = scores.size > 0;
    const similarityMin = strict ? TRGM_STRICT_MIN : TRGM_SIMILARITY_MIN;
    const wordMin = strict ? TRGM_STRICT_MIN : wordSimilarityMin(q);
    const fuzzy = await db.execute<MatchRow>(sql`
      SELECT p.id::text AS id,
             GREATEST(
               similarity(p.name, ${q}::text),
               word_similarity(${q}::text,
                 p.name || ' ' || t.name || ' ' || coalesce(
                   (SELECT string_agg(v.name, ' ')
                      FROM product_vibes pv JOIN vibes v ON v.id = pv.vibe_id
                     WHERE pv.product_id = p.id), ''))
             )::float8 AS score
      FROM products p
      JOIN product_types t ON t.id = p.type_id
      WHERE p.status = 'active' AND t.active
        AND (
          similarity(p.name, ${q}::text) > ${similarityMin}
          OR word_similarity(${q}::text,
               p.name || ' ' || t.name || ' ' || coalesce(
                 (SELECT string_agg(v.name, ' ')
                    FROM product_vibes pv JOIN vibes v ON v.id = pv.vibe_id
                   WHERE pv.product_id = p.id), '')) >= ${wordMin}
        )
    `);
    for (const r of fuzzy) {
      if (!scores.has(r.id)) {
        scores.set(r.id, TIER.fuzzy * 100 + Number(r.score));
        usedFuzzy = true;
      }
    }
  }
  return { scores, usedFuzzy };
}

function popularSuggestions(index: CatalogIndex, fallbackVibe: string | undefined, limit: number) {
  const vibe = fallbackVibe?.trim().toLowerCase();
  const inVibe = vibe ? index.products.filter((p) => p.vibeSlugs.includes(vibe)) : [];
  const pool = inVibe.length ? inVibe : index.products;
  const cmp = vibe && inVibe.length ? compareFeatured(vibe) : compareNewest;
  return pool
    .slice()
    .sort((a, b) => Number(b.inStock) - Number(a.inStock) || cmp(a, b))
    .slice(0, limit)
    .map(toCard);
}

/**
 * Search results with the same filters, facets, sorting and paging as `listProducts`.
 * An empty (or all-junk) query returns no items plus suggestions.
 */
export async function searchProducts(
  db: DbClient,
  params: SearchParams,
  opts: { now?: Date } = {},
): Promise<SearchResult> {
  const now = opts.now ?? new Date();
  const query = sanitizeSearchQuery(params.q);
  const { q: _q, fallbackVibe, ...listParams } = params;
  void _q;

  const { scores, usedFuzzy } = await findSearchMatches(db, query);
  const index = await loadCatalogIndex(db, {
    now,
    productIds: scores.size ? [...scores.keys()] : [],
  });
  const result = runListing(
    index,
    { ...listParams, sort: params.sort ?? "relevance" },
    { relevance: scores },
  );

  let suggestions: ProductCard[] = [];
  if (result.total === 0) {
    const full = await loadCatalogIndex(db, { now });
    suggestions = popularSuggestions(full, fallbackVibe ?? params.featuredForVibe, 8);
  }
  return { ...result, query, usedFuzzy, suggestions };
}

export interface QuickSearchResult {
  query: string;
  products: ProductCard[];
  /** Vibes / types whose name starts with or contains the query, for "gothic" style shortcuts. */
  collections: { kind: "vibe" | "type"; slug: string; name: string }[];
}

/** Header instant results: top `limit` products by relevance (in-stock listing rules apply). */
export async function quickSearch(
  db: DbClient,
  q: string,
  limit = 6,
  opts: { now?: Date } = {},
): Promise<QuickSearchResult> {
  const query = sanitizeSearchQuery(q);
  if (!query) return { query, products: [], collections: [] };
  const { scores } = await findSearchMatches(db, query);
  const index = await loadCatalogIndex(db, {
    now: opts.now ?? new Date(),
    productIds: scores.size ? [...scores.keys()] : [],
  });
  const result = runListing(
    index,
    { sort: "relevance", page: 1, pageSize: Math.min(Math.max(1, limit), 20) },
    { relevance: scores },
  );
  const needle = query.toLowerCase();
  const collections = [
    ...index.vibes.map((v) => ({ kind: "vibe" as const, slug: v.slug, name: v.name })),
    ...index.types.map((t) => ({ kind: "type" as const, slug: t.slug, name: t.name })),
  ].filter((c) => c.name.toLowerCase().includes(needle) || c.slug.includes(needle));
  return { query, products: result.items.slice(0, limit), collections };
}
