import { and, eq, notInArray } from "drizzle-orm";

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
