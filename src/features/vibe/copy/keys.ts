/**
 * Copy keys for expressive surfaces ONLY (plan section 8.5). Checkout, payment, legal, error-critical and
 * notification copy is neutral and fixed; it does not belong here.
 * Dark-pattern rules (plan section 3): no confirm-shaming, no false urgency or scarcity in any vibe.
 */
export const COPY_KEYS = [
  "hero.headline",
  "hero.sub",
  "hero.cta",
  "home.featuredTitle",
  "home.vibesTitle",
  "cart.emptyTitle",
  "cart.emptyBody",
  "search.noResultsTitle",
  "search.noResultsBody",
  "wishlist.emptyTitle",
  "notFound.title",
  "notFound.body",
  "toast.addedToCart",
  "vibe.wearThis",
] as const;

export type CopyKey = (typeof COPY_KEYS)[number];
export type CopyDictionary = Record<CopyKey, string>;
