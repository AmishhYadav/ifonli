/**
 * Cache tag scheme (pure: no `next/*` imports, so it is unit-testable and importable anywhere).
 *
 *   product:{id}                  one product (PDP model)
 *   product-slug:{slug}           PDP looked up by slug (invalidate the OLD slug on rename)
 *   collection:vibe:{slug}        everything shown for a vibe (lists, PDPs in it, collection copy)
 *   collection:type:{slug}        same for a product type
 *   catalog                       any product change (shop lists, search-adjacent lists, home sets,
 *                                 related products, sitemap)
 *   content                       banners, featured sets, hero tiles, FAQs, policies
 *   settings                      store settings that leak into cached output (manufacturer, ...)
 *   stock:{productId}             stock-dependent cached data (inStock / lowStock flags) of a product
 *   stock                         global stock tag for lists that FILTER by stock (inStockOnly)
 */

export const CATALOG_TAG = "catalog";
export const CONTENT_TAG = "content";
export const SETTINGS_TAG = "settings";
export const STOCK_TAG = "stock";

/** Next allows 128 tags per entry and 256 characters per tag. */
export const MAX_TAGS_PER_ENTRY = 128;
const MAX_TAG_LENGTH = 200;
/** Above this many per-product stock tags an entry falls back to the global `stock` tag. */
const MAX_STOCK_TAGS = 80;

export const productTag = (id: string) => `product:${id}`;
export const productSlugTag = (slug: string) => `product-slug:${slug}`;
export const vibeCollectionTag = (slug: string) => `collection:vibe:${slug}`;
export const typeCollectionTag = (slug: string) => `collection:type:${slug}`;
export const stockTag = (productId: string) => `stock:${productId}`;

function clean(tags: Iterable<string>): string[] {
  return [...new Set(tags)].filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH);
}

/** Tags for per-item stock flags in a result; falls back to the global tag for big results. */
export function stockTagsFor(productIds: readonly string[]): string[] {
  if (productIds.length > MAX_STOCK_TAGS) return [STOCK_TAG];
  return productIds.map(stockTag);
}

export interface ListingTagInput {
  vibes?: readonly string[];
  types?: readonly string[];
  featuredForVibe?: string;
  inStockOnly?: boolean;
}

/** Tags for a product-listing cache entry given its filters and the product ids it returned. */
export function listingTags(input: ListingTagInput, productIds: readonly string[]): string[] {
  return clean([
    CATALOG_TAG,
    ...(input.vibes ?? []).map(vibeCollectionTag),
    ...(input.types ?? []).map(typeCollectionTag),
    ...(input.featuredForVibe ? [vibeCollectionTag(input.featuredForVibe)] : []),
    ...(input.inStockOnly ? [STOCK_TAG] : []),
    ...stockTagsFor(productIds),
  ]);
}

export interface CatalogInvalidation {
  productIds?: readonly string[];
  /** Slugs the products have now AND (on rename) had before. */
  productSlugs?: readonly string[];
  /** Vibes the products are/were in, or vibes whose own copy changed. */
  vibeSlugs?: readonly string[];
  typeSlugs?: readonly string[];
}

/**
 * Tags to expire after an admin catalogue mutation. Any product-level change (ids or slugs given)
 * also expires `catalog`; a vibe/type-only change (editing a collection's copy) only expires that
 * collection's tag, so unrelated lists stay warm.
 */
export function catalogInvalidationTags(input: CatalogInvalidation): string[] {
  const productLevel = (input.productIds?.length ?? 0) + (input.productSlugs?.length ?? 0) > 0;
  return clean([
    ...(productLevel ? [CATALOG_TAG] : []),
    ...(input.productIds ?? []).map(productTag),
    ...(input.productSlugs ?? []).map(productSlugTag),
    ...(input.vibeSlugs ?? []).map(vibeCollectionTag),
    ...(input.typeSlugs ?? []).map(typeCollectionTag),
  ]);
}

/** Tags to expire when stock changes for these products (sale, restock, adjustment, cancel). */
export function stockInvalidationTags(productIds: readonly string[]): string[] {
  return clean([STOCK_TAG, ...productIds.map(stockTag)]);
}
