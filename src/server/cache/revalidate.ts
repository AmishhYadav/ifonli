import "server-only";

import { revalidateTag, updateTag } from "next/cache";

import {
  CONTENT_TAG,
  SETTINGS_TAG,
  catalogInvalidationTags,
  stockInvalidationTags,
  type CatalogInvalidation,
} from "./tags";

/**
 * Cache invalidation for mutations.
 *
 * Which Next 16 API (docs: functions/updateTag, functions/revalidateTag):
 *  - `updateTag(tag)` is for Server Actions only and expires the entry immediately: the next
 *    request blocks for fresh data (read-your-own-writes). Admin edits run in Server Actions and
 *    the owner expects the storefront / preview to show the change straight away, so this is the
 *    DEFAULT (`via: "action"`).
 *  - `revalidateTag(tag, "max")` works in Route Handlers too and serves stale content while it
 *    refreshes in the background (stale-while-revalidate). Use `via: "route"` from webhooks,
 *    cron jobs and other non-action contexts (e.g. the Razorpay webhook decrementing stock).
 *    The profile argument is mandatory in Next 16; the single-argument form is deprecated.
 */
export type InvalidationVia = "action" | "route";

function expire(tags: readonly string[], via: InvalidationVia): void {
  for (const tag of tags) {
    if (via === "action") updateTag(tag);
    else revalidateTag(tag, "max");
  }
}

/** After creating/updating/archiving products or editing a vibe / type. */
export function revalidateCatalog(
  input: CatalogInvalidation,
  opts: { via?: InvalidationVia } = {},
): void {
  expire(catalogInvalidationTags(input), opts.via ?? "action");
}

/** After a stock change (adjustment, sale, cancellation restock). */
export function revalidateStock(
  input: { productIds: readonly string[] },
  opts: { via?: InvalidationVia } = {},
): void {
  expire(stockInvalidationTags(input.productIds), opts.via ?? "action");
}

/** After editing banners, featured/hero sets, FAQs or policies. */
export function revalidateContent(opts: { via?: InvalidationVia } = {}): void {
  expire([CONTENT_TAG], opts.via ?? "action");
}

/** After changing a store setting that appears in cached output (manufacturer, country, ...). */
export function revalidateSettings(opts: { via?: InvalidationVia } = {}): void {
  expire([SETTINGS_TAG], opts.via ?? "action");
}
