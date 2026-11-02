import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { products, variants } from "@/server/db/schema";
import {
  getAllProductSlugsForSitemap,
  getCollections,
  getFeaturedForAllVibes,
  getHeroTilesForAllVibes,
  getHomeFeaturedForAllVibes,
  getLiveAvailability,
  getProductBySlug,
  getRelatedProducts,
  listProducts,
} from "@/server/services/catalog";
import { setSetting } from "@/server/services/settings";

import { addSlot, reserve, seedCatalogFixture } from "./catalog-fixture";

const db = () => getDb();
const names = (r: { items: { name: string }[] }) => r.items.map((i) => i.name);

describe("listProducts", () => {
  it("returns only visible products (active, active type, >=1 active variant)", async () => {
    await seedCatalogFixture();
    const r = await listProducts(db(), { sort: "newest" });
    expect(names(r)).toEqual(["Spiky Charm", "Ghost Sticker", "Cat Sticker", "Heart Charm", "Skull Charm"]);
    expect(r.total).toBe(5);
    expect(r.hasMore).toBe(false);
  });

  it("builds product cards: price/MRP from the cheapest variant, multi-variant flag, images", async () => {
    await seedCatalogFixture();
    const r = await listProducts(db(), {});
    const heart = r.items.find((i) => i.slug === "heart-charm")!;
    expect(heart).toMatchObject({
      typeSlug: "charms",
      typeName: "Charms",
      vibeSlugs: ["cute"],
      primaryVibe: "cute",
      priceFromPaise: 14900,
      mrpFromPaise: 14900,
      hasPriceRange: true,
      inStock: true,
    });
    // cutout-only product: image falls back to the cutout
    expect(heart.image?.path).toContain("heart-cutout");
    expect(heart.cutout?.path).toContain("heart-cutout");

    const skull = r.items.find((i) => i.slug === "skull-charm")!;
    expect(skull).toMatchObject({ priceFromPaise: 19900, mrpFromPaise: 24900, hasPriceRange: false });
    expect(skull.image?.path).toContain("skull-photo");
    expect(skull.cutout?.path).toContain("skull-cutout");
    expect(skull.image).toEqual({
      path: "/placeholders/cutouts/skull-photo.svg",
      alt: "skull photo",
      width: 512,
      height: 512,
    });
    // primary vibe: lowest featured_rank (gothic r0 beats bold r2)
    expect(skull.primaryVibe).toBe("gothic");
    expect(skull.vibeSlugs).toEqual(["gothic", "bold"]);

    const ghost = r.items.find((i) => i.slug === "ghost-sticker")!;
    expect(ghost.image).toBeNull();
    expect(ghost.cutout).toBeNull();
  });

  it("filters by vibe, type, price range, madeIn", async () => {
    await seedCatalogFixture();
    expect(names(await listProducts(db(), { vibes: ["gothic"], sort: "newest" }))).toEqual([
      "Ghost Sticker",
      "Skull Charm",
    ]);
    expect(names(await listProducts(db(), { vibes: ["gothic", "cute"], sort: "newest" }))).toEqual([
      "Ghost Sticker",
      "Cat Sticker",
      "Heart Charm",
      "Skull Charm",
    ]);
    expect(names(await listProducts(db(), { types: ["3d-stickers"], sort: "newest" }))).toEqual([
      "Ghost Sticker",
      "Cat Sticker",
    ]);
    expect(
      names(await listProducts(db(), { vibes: ["bold"], types: ["charms"], sort: "price_asc" })),
    ).toEqual(["Skull Charm", "Spiky Charm"]);
    // price filter uses priceFromPaise (Heart's cheapest variant is 149.00, not 179.00)
    expect(
      names(await listProducts(db(), { priceMinPaise: 12000, priceMaxPaise: 19900, sort: "price_asc" })),
    ).toEqual(["Ghost Sticker", "Heart Charm", "Skull Charm"]);
    expect(names(await listProducts(db(), { madeIn: ["japan"] }))).toEqual(["Cat Sticker"]);
    expect(names(await listProducts(db(), { vibes: ["nope"] }))).toEqual([]);
  });

  it("inStockOnly respects active reservations but ignores expired ones", async () => {
    const f = await seedCatalogFixture();
    // Cat has 3 on hand. An ACTIVE reservation of 3 makes it unavailable; an EXPIRED one does not.
    await reserve(f.variants.cat!, 3, 15);
    await reserve(f.variants.ghost!, 20, -5); // expired: Ghost stays available
    const r = await listProducts(db(), { inStockOnly: true, sort: "newest" });
    expect(names(r)).toEqual(["Spiky Charm", "Ghost Sticker", "Heart Charm", "Skull Charm"]);

    const all = await listProducts(db(), { sort: "newest" });
    expect(all.items.find((i) => i.slug === "cat-sticker")?.inStock).toBe(false);
    expect(all.items.find((i) => i.slug === "ghost-sticker")?.inStock).toBe(true);
  });

  it("a product is in stock if ANY active variant is available", async () => {
    const f = await seedCatalogFixture();
    // Heart: Pink 5 on hand reserved fully -> Red already 0 -> out of stock
    const before = await listProducts(db(), { vibes: ["cute"] });
    expect(before.items.find((i) => i.slug === "heart-charm")?.inStock).toBe(true);
    await reserve(f.variants.heartPink!, 5, 10);
    const after = await listProducts(db(), { vibes: ["cute"] });
    expect(after.items.find((i) => i.slug === "heart-charm")?.inStock).toBe(false);
  });

  it("lowStock: in stock and every variant at/below its threshold (override else setting)", async () => {
    const f = await seedCatalogFixture();
    const r = await listProducts(db(), {});
    const bySlug = Object.fromEntries(r.items.map((i) => [i.slug, i]));
    // default threshold placeholder = 5
    expect(bySlug["cat-sticker"]!.lowStock).toBe(true); // 3 <= 5
    expect(bySlug["skull-charm"]!.lowStock).toBe(false); // 10 > 5
    // Heart: Pink 5 (<=5) and Red 0 (<=5) -> low
    expect(bySlug["heart-charm"]!.lowStock).toBe(true);
    // Setting changes the default; a per-variant override beats it
    await setSetting("default_low_stock_threshold", 2, null);
    const r2 = await listProducts(db(), {});
    expect(r2.items.find((i) => i.slug === "cat-sticker")!.lowStock).toBe(false);
    await db().update(variants).set({ lowStockThreshold: 3 }).where(eq(variants.id, f.variants.cat!));
    const r3 = await listProducts(db(), {});
    expect(r3.items.find((i) => i.slug === "cat-sticker")!.lowStock).toBe(true);
  });

  it("quickAddVariantId: the only active variant when it has stock, else null", async () => {
    const f = await seedCatalogFixture();
    const bySlug = async () => Object.fromEntries((await listProducts(db(), {})).items.map((i) => [i.slug, i]));
    const first = await bySlug();
    expect(first["skull-charm"]!.quickAddVariantId).toBe(f.variants.skull);
    expect(first["cat-sticker"]!.quickAddVariantId).toBe(f.variants.cat);
    // Two active variants: the shopper has to choose on the product page.
    expect(first["heart-charm"]!.quickAddVariantId).toBeNull();
    // An active reservation that takes all stock sold the variant out; an expired one does not.
    await reserve(f.variants.cat!, 3, 10);
    await reserve(f.variants.ghost!, 20, -5);
    const after = await bySlug();
    expect(after["cat-sticker"]!.inStock).toBe(false);
    expect(after["cat-sticker"]!.quickAddVariantId).toBeNull();
    expect(after["ghost-sticker"]!.quickAddVariantId).toBe(f.variants.ghost);
  });

  it("a sold-out product is never lowStock", async () => {
    const f = await seedCatalogFixture();
    await reserve(f.variants.cat!, 3, 10);
    const r = await listProducts(db(), { types: ["3d-stickers"] });
    const cat = r.items.find((i) => i.slug === "cat-sticker")!;
    expect(cat.inStock).toBe(false);
    expect(cat.lowStock).toBe(false);
  });

  it("sorts: newest, price asc/desc, featured within a vibe", async () => {
    await seedCatalogFixture();
    expect(names(await listProducts(db(), { sort: "price_asc" }))).toEqual([
      "Cat Sticker",
      "Ghost Sticker",
      "Heart Charm",
      "Skull Charm",
      "Spiky Charm",
    ]);
    expect(names(await listProducts(db(), { sort: "price_desc" }))).toEqual([
      "Spiky Charm",
      "Skull Charm",
      "Heart Charm",
      "Ghost Sticker",
      "Cat Sticker",
    ]);
    // featured with a single vibe: by that vibe's featured_rank
    expect(names(await listProducts(db(), { vibes: ["gothic"], sort: "featured" }))).toEqual([
      "Skull Charm", // r0
      "Ghost Sticker", // r1
    ]);
    expect(names(await listProducts(db(), { vibes: ["cute"], sort: "featured" }))).toEqual([
      "Heart Charm", // r0
      "Cat Sticker", // r1
    ]);
    // featuredForVibe orders an unfiltered list: ranked first, unranked by newest
    expect(names(await listProducts(db(), { featuredForVibe: "bold" }))).toEqual([
      "Spiky Charm", // bold r0
      "Skull Charm", // bold r2
      "Ghost Sticker", // unranked, newest first
      "Cat Sticker",
      "Heart Charm",
    ]);
    // no vibe context: newest first
    expect(names(await listProducts(db(), { sort: "featured" }))).toEqual(
      names(await listProducts(db(), { sort: "newest" })),
    );
  });

  it("paginates with total / hasMore and clamps page size", async () => {
    await seedCatalogFixture();
    const p1 = await listProducts(db(), { sort: "price_asc", page: 1, pageSize: 2 });
    expect(names(p1)).toEqual(["Cat Sticker", "Ghost Sticker"]);
    expect(p1).toMatchObject({ total: 5, page: 1, pageSize: 2, hasMore: true });
    const p3 = await listProducts(db(), { sort: "price_asc", page: 3, pageSize: 2 });
    expect(names(p3)).toEqual(["Spiky Charm"]);
    expect(p3.hasMore).toBe(false);
    const beyond = await listProducts(db(), { sort: "price_asc", page: 9, pageSize: 2 });
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(5);
    expect((await listProducts(db(), { pageSize: 5000 })).pageSize).toBe(60);
    expect((await listProducts(db(), { page: -3, pageSize: 0 })).page).toBe(1);
  });

  it("computes disjunctive facets", async () => {
    await seedCatalogFixture();
    const all = await listProducts(db(), {});
    expect(all.facets.vibes).toEqual([
      { slug: "cute", name: "Cute", count: 2 },
      { slug: "bold", name: "Bold", count: 2 },
      { slug: "gothic", name: "Gothic", count: 2 },
    ]);
    expect(all.facets.types).toEqual([
      { slug: "charms", name: "Charms", count: 3 },
      { slug: "3d-stickers", name: "3D Stickers", count: 2 },
    ]);
    expect(all.facets.priceRange).toEqual({ min: 9900, max: 24900 });
    expect(all.facets.madeIn).toEqual([
      { country: "India", count: 4 },
      { country: "Japan", count: 1 },
    ]);

    // Filtering by type: type facet ignores its own filter; vibe facet reflects it.
    const stickers = await listProducts(db(), { types: ["3d-stickers"] });
    expect(stickers.total).toBe(2);
    expect(stickers.facets.types.map((t) => `${t.slug}:${t.count}`)).toEqual([
      "charms:3",
      "3d-stickers:2",
    ]);
    expect(stickers.facets.vibes.map((v) => `${v.slug}:${v.count}`)).toEqual(["cute:1", "gothic:1"]);

    // Price filter: priceRange ignores the price filter itself.
    const cheap = await listProducts(db(), { priceMaxPaise: 10000 });
    expect(cheap.total).toBe(1);
    expect(cheap.facets.priceRange).toEqual({ min: 9900, max: 24900 });

    // A selected value with no matches stays listed with count 0.
    const gothicStickersInJapan = await listProducts(db(), { madeIn: ["Japan"], vibes: ["gothic"] });
    expect(gothicStickersInJapan.total).toBe(0);
    expect(gothicStickersInJapan.facets.vibes.find((v) => v.slug === "gothic")?.count).toBe(0);
  });

  it("inStockOnly narrows facets too", async () => {
    const f = await seedCatalogFixture();
    await reserve(f.variants.cat!, 3, 10);
    const r = await listProducts(db(), { inStockOnly: true });
    expect(r.facets.types.find((t) => t.slug === "3d-stickers")?.count).toBe(1);
    expect(r.facets.madeIn).toEqual([{ country: "India", count: 4 }]);
  });
});

describe("getProductBySlug", () => {
  it("returns the full PDP model without stock, hsn or gst", async () => {
    const f = await seedCatalogFixture();
    const p = await getProductBySlug(db(), "heart-charm");
    expect(p).not.toBeNull();
    expect(p).toMatchObject({
      id: f.products["heart-charm"],
      slug: "heart-charm",
      name: "Heart Charm",
      type: { slug: "charms", name: "Charms" },
      primaryVibe: "cute",
      priceFromPaise: 14900,
      mrpFromPaise: 14900,
      hasPriceRange: true,
    });
    expect(p!.options).toHaveLength(1);
    expect(p!.options[0]!.name).toBe("Colour");
    expect(p!.options[0]!.values.map((v) => [v.value, v.swatchHex])).toEqual([
      ["Pink", "#FF5C8A"],
      ["Red", "#E5243B"],
    ]);
    expect(p!.variants.map((v) => [v.sku, v.title, v.pricePaise, v.mrpPaise, v.active])).toEqual([
      ["HT-PINK", "Pink", 14900, 14900, true],
      ["HT-RED", "Red", 17900, 19900, true],
    ]);
    expect(p!.variants[0]!.optionValueIds).toEqual([p!.options[0]!.values[0]!.id]);
    expect(p!.images.map((i) => i.kind)).toEqual(["cutout"]);

    const json = JSON.stringify(p);
    expect(json).not.toMatch(/stock/i);
    expect(json).not.toMatch(/hsn|gstRate/i);
  });

  it("orders images photo-first, then cutout", async () => {
    await seedCatalogFixture();
    const p = await getProductBySlug(db(), "skull-charm");
    expect(p!.images.map((i) => i.kind)).toEqual(["photo", "cutout"]);
    expect(p!.legal).toMatchObject({ netQuantity: "1 piece", dimensions: "2 cm", countryOfOrigin: "India" });
  });

  it("manufacturer falls back to the default_manufacturer setting, product override wins", async () => {
    const f = await seedCatalogFixture();
    // never written: registry placeholder, flagged
    const placeholder = await getProductBySlug(db(), "skull-charm");
    expect(placeholder!.legal.manufacturerSource).toBe("default");
    expect(placeholder!.legal.manufacturerIsPlaceholder).toBe(true);

    await setSetting(
      "default_manufacturer",
      { name: "IfOnli Crafts Pvt Ltd", address: "12 Market Rd, Pune 411001" },
      null,
    );
    const fallback = await getProductBySlug(db(), "skull-charm");
    expect(fallback!.legal.manufacturer).toEqual({
      name: "IfOnli Crafts Pvt Ltd",
      address: "12 Market Rd, Pune 411001",
    });
    expect(fallback!.legal).toMatchObject({ manufacturerSource: "default", manufacturerIsPlaceholder: false });

    await db()
      .update(products)
      .set({ manufacturerOverride: { name: "Partner Studio", address: "1 Lane, Delhi" } })
      .where(eq(products.id, f.products["skull-charm"]!));
    const overridden = await getProductBySlug(db(), "skull-charm");
    expect(overridden!.legal.manufacturer).toEqual({ name: "Partner Studio", address: "1 Lane, Delhi" });
    expect(overridden!.legal.manufacturerSource).toBe("product");

    // malformed override falls back to the default
    await db()
      .update(products)
      .set({ manufacturerOverride: { nope: true } })
      .where(eq(products.id, f.products["skull-charm"]!));
    expect((await getProductBySlug(db(), "skull-charm"))!.legal.manufacturerSource).toBe("default");
  });

  it("country of origin falls back to the default setting", async () => {
    const f = await seedCatalogFixture();
    await db().update(products).set({ countryOfOrigin: null }).where(eq(products.id, f.products["skull-charm"]!));
    await setSetting("default_country_of_origin", "India", null);
    const p = await getProductBySlug(db(), "skull-charm");
    expect(p!.legal).toMatchObject({ countryOfOrigin: "India", countryOfOriginIsPlaceholder: false });
  });

  it("returns null for unknown, draft, retired-type and variant-less products", async () => {
    await seedCatalogFixture();
    for (const slug of ["nope", "draft-thing", "retired-product", "no-variants", "inactive-variant-only"]) {
      expect(await getProductBySlug(db(), slug)).toBeNull();
    }
  });
});

describe("getLiveAvailability", () => {
  it("returns per-variant live availability, reservations and max_qty_per_line applied", async () => {
    const f = await seedCatalogFixture();
    await reserve(f.variants.skull!, 4, 10);
    await reserve(f.variants.skull!, 100, -1); // expired, ignored
    const live = await getLiveAvailability(db(), f.products["skull-charm"]!);
    expect(live).toEqual([
      { variantId: f.variants.skull, available: 6, inStock: true, lowStock: false, maxOrderable: 6 },
    ]);

    await setSetting("max_qty_per_line", 3, null);
    const capped = await getLiveAvailability(db(), f.products["skull-charm"]!);
    expect(capped[0]).toMatchObject({ available: 6, maxOrderable: 3 });

    const heart = await getLiveAvailability(db(), f.products["heart-charm"]!);
    expect(heart.map((h) => [h.available, h.inStock, h.lowStock, h.maxOrderable])).toEqual([
      [5, true, true, 3], // pink: 5 left, <= threshold 5
      [0, false, false, 0], // red: sold out is not "low"
    ]);
  });

  it("is empty for products with no active variants", async () => {
    const f = await seedCatalogFixture();
    expect(await getLiveAvailability(db(), f.products["inactive-variant-only"]!)).toEqual([]);
  });
});

describe("collections", () => {
  it("lists vibes and active types with counts", async () => {
    await seedCatalogFixture();
    const c = await getCollections(db());
    expect(c.vibes.map((v) => [v.slug, v.productCount])).toEqual([
      ["cute", 2],
      ["bold", 2],
      ["gothic", 2],
    ]);
    expect(c.types.map((t) => [t.slug, t.productCount])).toEqual([
      ["charms", 3],
      ["3d-stickers", 2],
    ]);
  });
});

describe("featured sets", () => {
  it("falls back to the newest products of each vibe when nothing is curated", async () => {
    await seedCatalogFixture();
    const sets = await getFeaturedForAllVibes(db(), 8);
    expect(Object.keys(sets).sort()).toEqual(["bold", "cute", "gothic"]);
    expect(sets.gothic!.map((c) => c.name)).toEqual(["Ghost Sticker", "Skull Charm"]);
    expect(sets.cute!.map((c) => c.name)).toEqual(["Cat Sticker", "Heart Charm"]);
    expect((await getFeaturedForAllVibes(db(), 1)).bold!.map((c) => c.name)).toEqual(["Spiky Charm"]);
  });

  it("uses curated featured_slots by rank, skipping hidden products", async () => {
    const f = await seedCatalogFixture();
    await addSlot(f.vibes.gothic, "home_featured", f.products["skull-charm"]!, 1);
    await addSlot(f.vibes.gothic, "home_featured", f.products["ghost-sticker"]!, 0);
    await addSlot(f.vibes.gothic, "home_featured", f.products["draft-thing"]!, 2); // hidden
    const sets = await getFeaturedForAllVibes(db(), 8);
    expect(sets.gothic!.map((c) => c.name)).toEqual(["Ghost Sticker", "Skull Charm"]);
    // other vibes still get the fallback
    expect(sets.cute).toHaveLength(2);
  });
});

describe("home featured sets (own-vibe products first)", () => {
  it("puts a vibe's own products before products only tagged with it, and keeps tagged ones as padding when it has few", async () => {
    const f = await seedCatalogFixture();
    // Skull Charm belongs to gothic (rank 0) and is only tagged bold (rank 2); Spiky Charm is bold's own.
    await addSlot(f.vibes.bold, "home_featured", f.products["skull-charm"]!, 0); // curated, but not bold's own
    const sets = await getHomeFeaturedForAllVibes(db(), 8);
    expect(sets.bold!.map((c) => c.name)).toEqual(["Spiky Charm", "Skull Charm"]);
    expect(sets.bold![0]!.primaryVibe).toBe("bold");
    expect(sets.gothic!.map((c) => c.primaryVibe)).toEqual(["gothic", "gothic"]);
    // The limit applies after ordering, so a tagged product never displaces an own one.
    expect((await getHomeFeaturedForAllVibes(db(), 1)).bold!.map((c) => c.name)).toEqual(["Spiky Charm"]);
  });
});

describe("hero tiles", () => {
  it("fallback requires a cutout image", async () => {
    await seedCatalogFixture();
    const tiles = await getHeroTilesForAllVibes(db(), 14);
    // gothic: Skull has a cutout; Ghost has none
    expect(tiles.gothic!.map((t) => t.name)).toEqual(["Skull Charm"]);
    expect(tiles.gothic![0]).toMatchObject({
      slug: "skull-charm",
      cutout: { path: "/placeholders/cutouts/skull-cutout.svg", width: 512, height: 512 },
    });
    // cute: Heart has a cutout; Cat only a photo
    expect(tiles.cute!.map((t) => t.name)).toEqual(["Heart Charm"]);
    // bold: ranked by bold featured rank (Spiky r0, Skull r2)
    expect(tiles.bold!.map((t) => t.name)).toEqual(["Spiky Charm", "Skull Charm"]);
  });

  it("uses curated hero_tiles slots but drops products without a cutout", async () => {
    const f = await seedCatalogFixture();
    await addSlot(f.vibes.gothic, "hero_tiles", f.products["ghost-sticker"]!, 0); // no cutout -> dropped
    await addSlot(f.vibes.gothic, "hero_tiles", f.products["skull-charm"]!, 1);
    const tiles = await getHeroTilesForAllVibes(db(), 14);
    expect(tiles.gothic!.map((t) => t.name)).toEqual(["Skull Charm"]);
  });

  it("curated slots that all lack cutouts fall back to cutout products", async () => {
    const f = await seedCatalogFixture();
    await addSlot(f.vibes.gothic, "hero_tiles", f.products["ghost-sticker"]!, 0);
    const tiles = await getHeroTilesForAllVibes(db(), 14);
    expect(tiles.gothic!.map((t) => t.name)).toEqual(["Skull Charm"]);
  });

  it("respects the limit", async () => {
    await seedCatalogFixture();
    expect((await getHeroTilesForAllVibes(db(), 1)).bold).toHaveLength(1);
  });
});

describe("related products and sitemap", () => {
  it("related: same primary vibe first, then same type, excluding self, in-stock first", async () => {
    const f = await seedCatalogFixture();
    // skull primary vibe = gothic -> Ghost (gothic), then same type charms: Spiky, Heart
    const rel = await getRelatedProducts(db(), f.products["skull-charm"]!, 8);
    expect(rel.map((c) => c.name)).toEqual(["Ghost Sticker", "Spiky Charm", "Heart Charm"]);
    expect((await getRelatedProducts(db(), f.products["skull-charm"]!, 2)).map((c) => c.name)).toEqual([
      "Ghost Sticker",
      "Spiky Charm",
    ]);
    await reserve(f.variants.ghost!, 20, 10); // Ghost sold out -> still first group, only one item
    const rel2 = await getRelatedProducts(db(), f.products["skull-charm"]!, 8);
    expect(rel2[0]!.name).toBe("Ghost Sticker");
    expect(await getRelatedProducts(db(), f.products["draft-thing"]!, 8)).toEqual([]);
  });

  it("sitemap slugs list visible products only", async () => {
    await seedCatalogFixture();
    const slugs = (await getAllProductSlugsForSitemap(db())).map((s) => s.slug);
    expect(slugs).toEqual(["cat-sticker", "ghost-sticker", "heart-charm", "skull-charm", "spiky-charm"]);
  });
});
