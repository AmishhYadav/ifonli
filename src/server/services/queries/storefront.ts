import { and, eq, notInArray } from "drizzle-orm";

import { DIY_PARTS_TYPE_SLUG } from "@/lib/diy";
import { productTypes } from "@/server/db/schema";

/**
 * Product types IfOnli no longer sells. They are hidden in code as well as switched off by migration 0007, so the
 * storefront is right whether or not that migration has run on the database being served.
 */
export const RETIRED_TYPE_SLUGS = ["hippers"] as const;

/** SQL condition: the type is switched on and not retired. Use wherever the storefront filters on `productTypes.active`. */
export const storefrontType = () =>
  and(eq(productTypes.active, true), notInArray(productTypes.slug, [...RETIRED_TYPE_SLUGS]));

export const isRetiredType = (slug: string) => (RETIRED_TYPE_SLUGS as readonly string[]).includes(slug);

/**
 * Types that are switched off for browsing (listings, search, navigation, product pages) but whose products can still
 * be bought through the cart: the free chain of a DIY pack lives in one. Not purchasable-by-default like a live type
 * (a shopper cannot find them), and not retired (their order lines stay valid).
 */
export const INTERNAL_TYPE_SLUGS: readonly string[] = [DIY_PARTS_TYPE_SLUG];

export const isInternalType = (slug: string) => INTERNAL_TYPE_SLUGS.includes(slug);
