"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import type { ResolvedImage } from "@/components/store/ProductCardView";
import { getDb } from "@/server/db";
import { imageProps } from "@/server/services/media";
import { loadCatalogIndex, toCard } from "@/server/services/queries/catalog-index";
import type { ProductCard } from "@/server/services/queries/types";

import { WISHLIST_MAX_ITEMS } from "./list";

const idsSchema = z.array(z.uuid()).max(WISHLIST_MAX_ITEMS);

/** One wishlist card, ready for `ProductCardView` in a client component. */
export interface WishlistItem {
  product: ProductCard;
  image: ResolvedImage | null;
  isCutout: boolean;
}

export type WishlistItemsResult =
  | { ok: true; items: WishlistItem[]; missingIds: string[] }
  | { ok: false; message: string };

/**
 * Card data for the product ids saved on the device, in the order given. Ids that are no longer
 * visible (archived, deleted) come back in `missingIds` so the client can forget them. Live stock
 * flags come straight from the database (nothing here is cached), so "Sold out" is current.
 */
export async function getWishlistItems(ids: string[]): Promise<WishlistItemsResult> {
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, message: "Your saved list could not be read." };
  if (parsed.data.length === 0) return { ok: true, items: [], missingIds: [] };
  try {
    const index = await loadCatalogIndex(getDb(), { now: new Date(), productIds: parsed.data });
    const byId = new Map(index.products.map((p) => [p.id, toCard(p)]));
    const items: WishlistItem[] = [];
    for (const id of parsed.data) {
      const product = byId.get(id);
      if (!product) continue;
      let image: ResolvedImage | null = null;
      if (product.image) {
        try {
          image = imageProps(product.image);
        } catch (error) {
          console.error(`wishlist: unusable image for "${product.slug}"`, error);
        }
      }
      const isCutout = Boolean(product.image && product.cutout && product.image.path === product.cutout.path);
      items.push({ product, image, isCutout });
    }
    return {
      ok: true,
      items,
      missingIds: parsed.data.filter((id) => !byId.has(id)),
    };
  } catch (e) {
    unstable_rethrow(e);
    console.error("getWishlistItems failed", e);
    return { ok: false, message: "We couldn't load your saved items. Please try again." };
  }
}
