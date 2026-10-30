import { and, asc, eq, inArray } from "drizzle-orm";

import {
  productImages,
  productTypes,
  productVibes,
  products,
  variants,
  vibes,
} from "@/server/db/schema";

import { readSettings, type DbClient } from "./shared";
import { loadVariantStock } from "./stock";
import type { ImageRef, ProductCard } from "./types";

/** A storefront-visible product: card data plus the fields the listing pipeline sorts/filters on. */
export interface IndexedProduct extends ProductCard {
  createdAt: Date;
  /** vibe slug -> featured_rank (null = not ranked) */
  vibeRanks: ReadonlyMap<string, number | null>;
  /** Effective country of origin (product value, else a non-placeholder store default). */
  countryOfOrigin: string | null;
}

export interface VibeRef {
  id: string;
  slug: string;
  name: string;
  sort: number;
}

export interface TypeRef {
  id: string;
  slug: string;
  name: string;
  sort: number;
}

export interface CatalogIndex {
  products: IndexedProduct[];
  vibes: VibeRef[];
  types: TypeRef[];
}

/**
 * Storefront visibility = product `active` AND its type `active` AND at least one active variant.
 * Loads every visible product (or just `productIds` of them) with its card data in a handful of
 * queries; filtering, faceting, sorting and paging then run in memory (`listing.ts`). Intended
 * scale: hundreds to low thousands of products, behind `'use cache'` wrappers.
 */
export async function loadCatalogIndex(
  db: DbClient,
  opts: { now: Date; productIds?: readonly string[] },
): Promise<CatalogIndex> {
  const { now } = opts;
  const [vibeRows, typeRows] = await Promise.all([
    db
      .select({ id: vibes.id, slug: vibes.slug, name: vibes.name, sort: vibes.sort })
      .from(vibes)
      .orderBy(asc(vibes.sort), asc(vibes.slug)),
    db
      .select({
        id: productTypes.id,
        slug: productTypes.slug,
        name: productTypes.name,
        sort: productTypes.sort,
      })
      .from(productTypes)
      .where(eq(productTypes.active, true))
      .orderBy(asc(productTypes.sort), asc(productTypes.slug)),
  ]);
  const empty: CatalogIndex = { products: [], vibes: vibeRows, types: typeRows };
  if (opts.productIds && opts.productIds.length === 0) return empty;

  const productRows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      typeId: products.typeId,
      typeSlug: productTypes.slug,
      typeName: productTypes.name,
      createdAt: products.createdAt,
      countryOfOrigin: products.countryOfOrigin,
    })
    .from(products)
    .innerJoin(productTypes, eq(products.typeId, productTypes.id))
    .where(
      and(
        eq(products.status, "active"),
        eq(productTypes.active, true),
        opts.productIds ? inArray(products.id, [...opts.productIds]) : undefined,
      ),
    );
  if (productRows.length === 0) return empty;
  const ids = productRows.map((p) => p.id);

  const [variantRows, pvRows, imageRows, settingsRead] = await Promise.all([
    db
      .select({
        id: variants.id,
        productId: variants.productId,
        pricePaise: variants.pricePaise,
        mrpPaise: variants.mrpPaise,
        position: variants.position,
      })
      .from(variants)
      .where(and(inArray(variants.productId, ids), eq(variants.active, true))),
    db
      .select({
        productId: productVibes.productId,
        vibeId: productVibes.vibeId,
        featuredRank: productVibes.featuredRank,
      })
      .from(productVibes)
      .where(inArray(productVibes.productId, ids)),
    db
      .select({
        productId: productImages.productId,
        kind: productImages.kind,
        path: productImages.path,
        alt: productImages.alt,
        width: productImages.width,
        height: productImages.height,
        position: productImages.position,
        createdAt: productImages.createdAt,
      })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.position), asc(productImages.createdAt), asc(productImages.id)),
    readSettings(db, ["default_low_stock_threshold", "default_country_of_origin"]),
  ]);
  const stock = await loadVariantStock(
    db,
    variantRows.map((v) => v.id),
    now,
  );
  const stockById = new Map(stock.map((s) => [s.variantId, s]));
  const defaultThreshold = settingsRead.default_low_stock_threshold.value;
  const defaultCountry = settingsRead.default_country_of_origin.isPlaceholder
    ? null
    : settingsRead.default_country_of_origin.value;

  const vibeById = new Map(vibeRows.map((v) => [v.id, v]));
  const variantsByProduct = group(variantRows, (v) => v.productId);
  const pvByProduct = group(pvRows, (r) => r.productId);
  const imagesByProduct = group(imageRows, (i) => i.productId);

  const out: IndexedProduct[] = [];
  for (const p of productRows) {
    const pVariants = (variantsByProduct.get(p.id) ?? [])
      .slice()
      .sort((a, b) => a.pricePaise - b.pricePaise || a.position - b.position);
    const cheapest = pVariants[0];
    if (!cheapest) continue; // no purchasable variant: not shown on the storefront

    let inStock = false;
    let allLow = true;
    for (const v of pVariants) {
      const s = stockById.get(v.id);
      const available = s?.available ?? 0;
      const threshold = s?.lowStockThreshold ?? defaultThreshold;
      if (available > 0) inStock = true;
      if (available > threshold) allLow = false;
    }

    const memberships = (pvByProduct.get(p.id) ?? [])
      .map((r) => ({ vibe: vibeById.get(r.vibeId), rank: r.featuredRank }))
      .filter((m): m is { vibe: VibeRef; rank: number | null } => m.vibe !== undefined)
      .sort(
        (a, b) =>
          (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY) ||
          a.vibe.sort - b.vibe.sort ||
          a.vibe.slug.localeCompare(b.vibe.slug),
      );

    const imgs = imagesByProduct.get(p.id) ?? [];
    const photo = imgs.find((i) => i.kind === "photo");
    const cutout = imgs.find((i) => i.kind === "cutout");

    out.push({
      id: p.id,
      slug: p.slug,
      name: p.name,
      typeSlug: p.typeSlug,
      typeName: p.typeName,
      vibeSlugs: memberships.map((m) => m.vibe.slug),
      primaryVibe: memberships[0]?.vibe.slug ?? null,
      priceFromPaise: cheapest.pricePaise,
      mrpFromPaise: cheapest.mrpPaise,
      hasMultipleVariants: pVariants.length > 1,
      inStock,
      lowStock: inStock && allLow,
      image: toImageRef(photo ?? cutout),
      cutout: toImageRef(cutout),
      createdAt: p.createdAt,
      vibeRanks: new Map(memberships.map((m) => [m.vibe.slug, m.rank])),
      countryOfOrigin: p.countryOfOrigin?.trim() || defaultCountry,
    });
  }
  return { products: out, vibes: vibeRows, types: typeRows };
}

export function toCard(p: IndexedProduct): ProductCard {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    typeSlug: p.typeSlug,
    typeName: p.typeName,
    vibeSlugs: p.vibeSlugs,
    primaryVibe: p.primaryVibe,
    priceFromPaise: p.priceFromPaise,
    mrpFromPaise: p.mrpFromPaise,
    hasMultipleVariants: p.hasMultipleVariants,
    inStock: p.inStock,
    lowStock: p.lowStock,
    image: p.image,
    cutout: p.cutout,
  };
}

function toImageRef(
  i: { path: string; alt: string; width: number | null; height: number | null } | undefined,
): ImageRef | null {
  return i ? { path: i.path, alt: i.alt, width: i.width, height: i.height } : null;
}

function group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}
