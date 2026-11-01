import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  featuredSlots,
  productImages,
  productOptionValues,
  productOptions,
  productSlugRedirects,
  productTypes,
  productVibes,
  products,
  variants,
  vibes,
} from "@/server/db/schema";
import { hasPriceRange } from "@/lib/money";
import { clampQtyWithReason } from "@/server/domain";

import {
  compareFeatured,
  compareNewest,
  runListing,
  type ListingSort,
} from "./queries/listing";
import {
  loadCatalogIndex,
  toCard,
  type CatalogIndex,
  type IndexedProduct,
} from "./queries/catalog-index";
import { readSettings, type DbClient } from "./queries/shared";
import { loadVariantStock } from "./queries/stock";
import type {
  Collections,
  HeroTile,
  ListProductsParams,
  LiveVariantAvailability,
  ProductCard,
  ProductDetail,
  ProductListResult,
} from "./queries/types";

export * from "./queries/types";
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./queries/listing";

export interface QueryOptions {
  /** Injectable clock (tests). Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Storefront product listing (active products only; see `loadCatalogIndex` for visibility).
 * Used by /shop, /vibes/[vibe], /types/[type].
 */
export async function listProducts(
  db: DbClient,
  params: ListProductsParams = {},
  opts: QueryOptions = {},
): Promise<ProductListResult> {
  const index = await loadCatalogIndex(db, { now: opts.now ?? new Date() });
  return runListing(index, params as Omit<ListProductsParams, "sort"> & { sort?: ListingSort });
}

const manufacturerSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
});

/**
 * Where an old product URL now lives: the CURRENT slug of the product that used to be served at
 * `oldSlug` (renamed by an admin), or null when there is no redirect or its product is no longer
 * public (a redirect to a page that 404s helps nobody). The caller only asks after
 * `getProductBySlug(oldSlug)` found nothing, so a live product always takes precedence.
 */
export async function getProductSlugRedirect(
  db: DbClient,
  oldSlug: string,
): Promise<{ slug: string; productId: string } | null> {
  const [row] = await db
    .select({ slug: products.slug, productId: products.id })
    .from(productSlugRedirects)
    .innerJoin(products, eq(productSlugRedirects.productId, products.id))
    .innerJoin(productTypes, eq(products.typeId, productTypes.id))
    .where(
      and(
        eq(productSlugRedirects.oldSlug, oldSlug),
        eq(products.status, "active"),
        eq(productTypes.active, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Full PDP model for an active, purchasable product, or null. No stock data (see below). */
export async function getProductBySlug(db: DbClient, slug: string): Promise<ProductDetail | null> {
  const [row] = await db
    .select({
      product: products,
      typeSlug: productTypes.slug,
      typeName: productTypes.name,
      typeDefinition: productTypes.definition,
    })
    .from(products)
    .innerJoin(productTypes, eq(products.typeId, productTypes.id))
    .where(
      and(eq(products.slug, slug), eq(products.status, "active"), eq(productTypes.active, true)),
    )
    .limit(1);
  if (!row) return null;
  const p = row.product;

  const [variantRows, optionRows, vibeRows, imageRows, settingsRead] = await Promise.all([
    db
      .select()
      .from(variants)
      .where(and(eq(variants.productId, p.id), eq(variants.active, true)))
      .orderBy(asc(variants.position), asc(variants.pricePaise), asc(variants.sku)),
    db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, p.id))
      .orderBy(asc(productOptions.position), asc(productOptions.name)),
    db
      .select({
        slug: vibes.slug,
        name: vibes.name,
        sort: vibes.sort,
        featuredRank: productVibes.featuredRank,
      })
      .from(productVibes)
      .innerJoin(vibes, eq(productVibes.vibeId, vibes.id))
      .where(eq(productVibes.productId, p.id)),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, p.id))
      .orderBy(asc(productImages.position), asc(productImages.createdAt), asc(productImages.id)),
    readSettings(db, ["default_manufacturer", "default_country_of_origin"]),
  ]);
  if (variantRows.length === 0) return null;

  const optionIds = optionRows.map((o) => o.id);
  const valueRows = optionIds.length
    ? await db
        .select()
        .from(productOptionValues)
        .where(inArray(productOptionValues.optionId, optionIds))
        .orderBy(asc(productOptionValues.position), asc(productOptionValues.value))
    : [];

  const sortedVibes = vibeRows
    .slice()
    .sort(
      (a, b) =>
        (a.featuredRank ?? Number.POSITIVE_INFINITY) - (b.featuredRank ?? Number.POSITIVE_INFINITY) ||
        a.sort - b.sort ||
        a.slug.localeCompare(b.slug),
    );

  const override = manufacturerSchema.safeParse(p.manufacturerOverride);
  const defaultMfr = settingsRead.default_manufacturer;
  const country = p.countryOfOrigin?.trim();

  const cheapest = variantRows.slice().sort((a, b) => a.pricePaise - b.pricePaise || a.position - b.position)[0]!;
  const kindOrder = { photo: 0, cutout: 1 } as const;

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    descriptionMd: p.descriptionMd,
    isKit: p.isKit,
    seoTitle: p.seoTitle,
    seoDesc: p.seoDesc,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    type: {
      id: p.typeId,
      slug: row.typeSlug,
      name: row.typeName,
      definition: row.typeDefinition,
    },
    vibes: sortedVibes.map((v) => ({ slug: v.slug, name: v.name, featuredRank: v.featuredRank })),
    primaryVibe: sortedVibes[0]?.slug ?? null,
    legal: {
      countryOfOrigin: country || settingsRead.default_country_of_origin.value,
      countryOfOriginIsPlaceholder: country ? false : settingsRead.default_country_of_origin.isPlaceholder,
      netQuantity: p.netQuantity,
      dimensions: p.dimensions,
      manufacturer: override.success ? override.data : defaultMfr.value,
      manufacturerSource: override.success ? "product" : "default",
      manufacturerIsPlaceholder: override.success ? false : defaultMfr.isPlaceholder,
    },
    options: optionRows.map((o) => ({
      id: o.id,
      name: o.name,
      position: o.position,
      values: valueRows
        .filter((v) => v.optionId === o.id)
        .map((v) => ({
          id: v.id,
          value: v.value,
          swatchHex: v.swatchHex,
          position: v.position,
        })),
    })),
    variants: variantRows.map((v) => ({
      id: v.id,
      sku: v.sku,
      title: v.title,
      optionValueIds: v.optionValueIds,
      pricePaise: v.pricePaise,
      mrpPaise: v.mrpPaise,
      weightG: v.weightG,
      position: v.position,
      active: v.active,
    })),
    images: imageRows
      .slice()
      .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.position - b.position)
      .map((i) => ({
        id: i.id,
        variantId: i.variantId,
        kind: i.kind,
        path: i.path,
        alt: i.alt,
        width: i.width,
        height: i.height,
        position: i.position,
        isPlaceholder: i.isPlaceholder,
      })),
    priceFromPaise: cheapest.pricePaise,
    mrpFromPaise: cheapest.mrpPaise,
    hasPriceRange: hasPriceRange(variantRows.map((v) => v.pricePaise)),
  };
}

/**
 * LIVE per-variant availability for a PDP (never cached): on hand minus active unexpired
 * reservations (`availableQty`), capped by `max_qty_per_line` (`clampQtyWithReason`).
 */
export async function getLiveAvailability(
  db: DbClient,
  productId: string,
  opts: QueryOptions = {},
): Promise<LiveVariantAvailability[]> {
  const variantRows = await db
    .select({ id: variants.id })
    .from(variants)
    .where(and(eq(variants.productId, productId), eq(variants.active, true)))
    .orderBy(asc(variants.position), asc(variants.pricePaise), asc(variants.sku));
  if (variantRows.length === 0) return [];
  const [stock, settingsRead] = await Promise.all([
    loadVariantStock(
      db,
      variantRows.map((v) => v.id),
      opts.now ?? new Date(),
    ),
    readSettings(db, ["default_low_stock_threshold", "max_qty_per_line"]),
  ]);
  const byId = new Map(stock.map((s) => [s.variantId, s]));
  const defaultThreshold = settingsRead.default_low_stock_threshold.value;
  const maxPerLine = settingsRead.max_qty_per_line.value;
  return variantRows.map(({ id }) => {
    const s = byId.get(id);
    const available = s?.available ?? 0;
    const threshold = s?.lowStockThreshold ?? defaultThreshold;
    return {
      variantId: id,
      available,
      inStock: available > 0,
      lowStock: available > 0 && available <= threshold,
      maxOrderable: clampQtyWithReason(maxPerLine, available, maxPerLine).qty,
    };
  });
}

/** Vibes + active product types with names, copy, sort and live product counts. */
export async function getCollections(db: DbClient, opts: QueryOptions = {}): Promise<Collections> {
  const [index, vibeRows, typeRows] = await Promise.all([
    loadCatalogIndex(db, { now: opts.now ?? new Date() }),
    db.select().from(vibes).orderBy(asc(vibes.sort), asc(vibes.slug)),
    db
      .select()
      .from(productTypes)
      .where(eq(productTypes.active, true))
      .orderBy(asc(productTypes.sort), asc(productTypes.slug)),
  ]);
  const vibeCount = new Map<string, number>();
  const typeCount = new Map<string, number>();
  for (const p of index.products) {
    typeCount.set(p.typeSlug, (typeCount.get(p.typeSlug) ?? 0) + 1);
    for (const v of p.vibeSlugs) vibeCount.set(v, (vibeCount.get(v) ?? 0) + 1);
  }
  return {
    vibes: vibeRows.map((v) => ({
      id: v.id,
      slug: v.slug,
      name: v.name,
      sort: v.sort,
      description: v.description,
      seoTitle: v.seoTitle,
      seoDesc: v.seoDesc,
      heroCopy: v.heroCopy,
      productCount: vibeCount.get(v.slug) ?? 0,
    })),
    types: typeRows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      sort: t.sort,
      description: null,
      definition: t.definition,
      seoTitle: t.seoTitle,
      seoDesc: t.seoDesc,
      productCount: typeCount.get(t.slug) ?? 0,
    })),
  };
}

interface SlotRow {
  vibeSlug: string;
  productId: string;
  rank: number;
}

async function loadSlots(
  db: DbClient,
  placement: "home_featured" | "hero_tiles",
): Promise<SlotRow[]> {
  return db
    .select({ vibeSlug: vibes.slug, productId: featuredSlots.productId, rank: featuredSlots.rank })
    .from(featuredSlots)
    .innerJoin(vibes, eq(featuredSlots.vibeId, vibes.id))
    .where(eq(featuredSlots.placement, placement))
    .orderBy(asc(featuredSlots.rank), asc(featuredSlots.createdAt), asc(featuredSlots.id));
}

/**
 * Home page "featured" set per vibe (plan 8.3 needs all five). Curated `featured_slots`
 * (`home_featured`, by rank) when the vibe has any visible curated product; otherwise the newest
 * active products tagged with the vibe. Curated sets are not topped up: the owner's choice wins.
 */
export async function getFeaturedForAllVibes(
  db: DbClient,
  limitPerVibe = 8,
  opts: QueryOptions = {},
): Promise<Record<string, ProductCard[]>> {
  const [index, slots] = await Promise.all([
    loadCatalogIndex(db, { now: opts.now ?? new Date() }),
    loadSlots(db, "home_featured"),
  ]);
  const byId = new Map(index.products.map((p) => [p.id, p]));
  const result: Record<string, ProductCard[]> = {};
  for (const vibe of index.vibes) {
    const curated = slots
      .filter((s) => s.vibeSlug === vibe.slug)
      .map((s) => byId.get(s.productId))
      .filter((p): p is IndexedProduct => p !== undefined);
    const chosen = curated.length
      ? curated
      : index.products.filter((p) => p.vibeSlugs.includes(vibe.slug)).sort(compareNewest);
    result[vibe.slug] = chosen.slice(0, Math.max(0, limitPerVibe)).map(toCard);
  }
  return result;
}

/**
 * Hero tiles per vibe: curated `hero_tiles` slots (by rank) whose product has a cutout image;
 * otherwise active products of the vibe that have a cutout (vibe featured rank, then newest).
 * Fewer tiles than `limit` is fine; the hero repeats them.
 */
export async function getHeroTilesForAllVibes(
  db: DbClient,
  limit = 14,
  opts: QueryOptions = {},
): Promise<Record<string, HeroTile[]>> {
  const [index, slots] = await Promise.all([
    loadCatalogIndex(db, { now: opts.now ?? new Date() }),
    loadSlots(db, "hero_tiles"),
  ]);
  const byId = new Map(index.products.map((p) => [p.id, p]));
  const toTile = (p: IndexedProduct): HeroTile | null =>
    p.cutout ? { productId: p.id, slug: p.slug, name: p.name, cutout: p.cutout } : null;
  const result: Record<string, HeroTile[]> = {};
  for (const vibe of index.vibes) {
    const curated = slots
      .filter((s) => s.vibeSlug === vibe.slug)
      .map((s) => byId.get(s.productId))
      .filter((p): p is IndexedProduct => p !== undefined)
      .map(toTile)
      .filter((t): t is HeroTile => t !== null);
    const tiles = curated.length
      ? curated
      : index.products
          .filter((p) => p.cutout && p.vibeSlugs.includes(vibe.slug))
          .sort(compareFeatured(vibe.slug))
          .map(toTile)
          .filter((t): t is HeroTile => t !== null);
    result[vibe.slug] = tiles.slice(0, Math.max(0, limit));
  }
  return result;
}

/**
 * "You may also like": products sharing the source product's primary vibe first, then products of
 * the same type; each group in featured-rank/newest order with in-stock items ahead of sold-out.
 */
export async function getRelatedProducts(
  db: DbClient,
  productId: string,
  limit = 8,
  opts: QueryOptions = {},
): Promise<ProductCard[]> {
  const index: CatalogIndex = await loadCatalogIndex(db, { now: opts.now ?? new Date() });
  const source = index.products.find((p) => p.id === productId);
  if (!source) return [];
  const order = (list: IndexedProduct[], vibe: string | null) => {
    const cmp = vibe ? compareFeatured(vibe) : compareNewest;
    return list.sort((a, b) => Number(b.inStock) - Number(a.inStock) || cmp(a, b));
  };
  const others = index.products.filter((p) => p.id !== productId);
  const sameVibe = source.primaryVibe
    ? order(
        others.filter((p) => p.vibeSlugs.includes(source.primaryVibe!)),
        source.primaryVibe,
      )
    : [];
  const seen = new Set(sameVibe.map((p) => p.id));
  const sameType = order(
    others.filter((p) => p.typeSlug === source.typeSlug && !seen.has(p.id)),
    source.primaryVibe,
  );
  return [...sameVibe, ...sameType].slice(0, Math.max(0, limit)).map(toCard);
}

/** Slugs of every storefront-visible product, for `sitemap.ts`. */
export async function getAllProductSlugsForSitemap(
  db: DbClient,
): Promise<{ slug: string; updatedAt: Date }[]> {
  return db
    .select({ slug: products.slug, updatedAt: products.updatedAt })
    .from(products)
    .innerJoin(productTypes, eq(products.typeId, productTypes.id))
    .where(
      and(
        eq(products.status, "active"),
        eq(productTypes.active, true),
        sql`exists (select 1 from ${variants} where ${variants.productId} = ${products.id} and ${variants.active})`,
      ),
    )
    .orderBy(asc(products.slug));
}
