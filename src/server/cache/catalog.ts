import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { getDb } from "@/server/db";
import * as catalog from "@/server/services/catalog";
import type {
  Collections,
  HeroTile,
  ListProductsParams,
  ProductCard,
  ProductDetail,
  ProductListResult,
} from "@/server/services/catalog";

import {
  CATALOG_TAG,
  CONTENT_TAG,
  SETTINGS_TAG,
  listingTags,
  productSlugTag,
  productTag,
  stockTagsFor,
  typeCollectionTag,
  vibeCollectionTag,
} from "./tags";

/**
 * Cached catalogue reads (Cache Components `'use cache'`). Each is a thin wrapper over the plain
 * query function of the same name in `services/catalog.ts`; keep logic out of here. Arguments must
 * be plain serialisable values and are part of the cache key, so pages should validate/normalise
 * URL params (known vibe/type slugs, bounded page sizes) before calling.
 *
 * Stock note: cards carry `inStock` / `lowStock`, so entries are tagged with `stock:{id}` of the
 * products they contain (global `stock` for `inStockOnly` lists). `revalidateStock` expires them.
 * The PDP model itself holds no stock; fetch `getLiveAvailability` in an uncached Suspense hole.
 */

export async function listProducts(params: ListProductsParams = {}): Promise<ProductListResult> {
  "use cache";
  cacheLife("hours");
  cacheTag(...listingTags(params, []));
  const result = await catalog.listProducts(getDb(), params);
  cacheTag(...listingTags(params, result.items.map((i) => i.id)));
  return result;
}

export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(SETTINGS_TAG, productSlugTag(slug));
  const product = await catalog.getProductBySlug(getDb(), slug);
  if (product) {
    cacheTag(
      productTag(product.id),
      typeCollectionTag(product.type.slug),
      ...product.vibes.map((v) => vibeCollectionTag(v.slug)),
    );
  }
  return product;
}

export async function getCollections(): Promise<Collections> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG);
  const collections = await catalog.getCollections(getDb());
  cacheTag(
    ...collections.vibes.map((v) => vibeCollectionTag(v.slug)),
    ...collections.types.map((t) => typeCollectionTag(t.slug)),
  );
  return collections;
}

export async function getFeaturedForAllVibes(
  limitPerVibe = 8,
): Promise<Record<string, ProductCard[]>> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, CONTENT_TAG);
  const sets = await catalog.getFeaturedForAllVibes(getDb(), limitPerVibe);
  cacheTag(...stockTagsFor(Object.values(sets).flatMap((cards) => cards.map((c) => c.id))));
  return sets;
}

export async function getHeroTilesForAllVibes(limit = 14): Promise<Record<string, HeroTile[]>> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, CONTENT_TAG);
  return catalog.getHeroTilesForAllVibes(getDb(), limit);
}

export async function getRelatedProducts(productId: string, limit = 8): Promise<ProductCard[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, productTag(productId));
  const related = await catalog.getRelatedProducts(getDb(), productId, limit);
  cacheTag(...stockTagsFor(related.map((c) => c.id)));
  return related;
}

export async function getAllProductSlugsForSitemap(): Promise<{ slug: string; updatedAt: Date }[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG);
  return catalog.getAllProductSlugsForSitemap(getDb());
}
