import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { products } from "@/server/db/schema";
import { quickSearch, searchProducts } from "@/server/services/search";

import { reserve, seedCatalogFixture } from "./catalog-fixture";

const db = () => getDb();
const search = (q: string, extra: Record<string, unknown> = {}) =>
  searchProducts(db(), { q, ...extra });
const names = (r: { items: { name: string }[] }) => r.items.map((i) => i.name);

describe("searchProducts", () => {
  it("finds an exact name and ranks it first", async () => {
    await seedCatalogFixture();
    const r = await search("Skull Charm");
    expect(names(r)[0]).toBe("Skull Charm");
    expect(r.query).toBe("Skull Charm");
    expect(r.usedFuzzy).toBe(false);
    expect(r.suggestions).toEqual([]);
  });

  it("matches multiword queries (all words, any order) and stems plurals", async () => {
    await seedCatalogFixture();
    expect(names(await search("heart charm"))).toEqual(["Heart Charm"]);
    expect(names(await search("charm heart"))).toEqual(["Heart Charm"]);
    expect(names(await search("grinning skull"))).toEqual(["Skull Charm"]); // description match
  });

  it("matches vibe names", async () => {
    await seedCatalogFixture();
    expect(names(await search("gothic")).sort()).toEqual(["Ghost Sticker", "Skull Charm"]);
    expect(names(await search("Cute")).sort()).toEqual(["Cat Sticker", "Heart Charm"]);
  });

  it("matches type names ('sticker', 'stickers')", async () => {
    await seedCatalogFixture();
    expect(names(await search("sticker")).sort()).toEqual(["Cat Sticker", "Ghost Sticker"]);
    expect(names(await search("stickers")).sort()).toEqual(["Cat Sticker", "Ghost Sticker"]);
  });

  it("combines type and vibe names across fields ('gothic charm')", async () => {
    await seedCatalogFixture();
    expect(names(await search("gothic charm"))).toEqual(["Skull Charm"]);
    expect(names(await search("gothic sticker"))).toEqual(["Ghost Sticker"]);
  });

  it("tolerates typos through trigram fallback", async () => {
    await seedCatalogFixture();
    const skul = await search("skul");
    expect(names(skul)).toEqual(["Skull Charm"]);
    expect(skul.usedFuzzy).toBe(true);
    expect(names(await search("hart charm"))[0]).toBe("Heart Charm");
    expect(names(await search("stiker")).sort()).toEqual(["Cat Sticker", "Ghost Sticker"]);
  });

  it("matches a SKU prefix first", async () => {
    await seedCatalogFixture();
    expect(names(await search("SK-1"))).toEqual(["Skull Charm"]);
    expect(names(await search("ht-p"))).toEqual(["Heart Charm"]);
  });

  it("never returns hidden products (draft, retired type, no active variant)", async () => {
    await seedCatalogFixture();
    for (const q of ["draft", "retired", "variants", "inactive"]) {
      expect(names(await search(q))).toEqual([]);
    }
  });

  it("empty or junk queries return no items plus suggestions", async () => {
    await seedCatalogFixture();
    for (const q of ["", "   ", "\u0000\u0007", "the"]) {
      const r = await search(q, { fallbackVibe: "gothic" });
      expect(r.items).toEqual([]);
      expect(r.total).toBe(0);
      // suggestions come from the fallback vibe, by its featured rank (Skull r0, Ghost r1)
      expect(names({ items: r.suggestions })).toEqual(["Skull Charm", "Ghost Sticker"]);
    }
  });

  it("no results: suggestions come from fallbackVibe, else the newest in-stock products", async () => {
    await seedCatalogFixture();
    const gothic = await search("zzzzqqq", { fallbackVibe: "gothic" });
    expect(gothic.total).toBe(0);
    expect(names({ items: gothic.suggestions })).toEqual(["Skull Charm", "Ghost Sticker"]);
    const any = await search("zzzzqqq");
    expect(any.suggestions.length).toBeGreaterThan(0);
    expect(names({ items: any.suggestions })[0]).toBe("Spiky Charm");
    const unknownVibe = await search("zzzzqqq", { fallbackVibe: "no-such-vibe" });
    expect(unknownVibe.suggestions.length).toBeGreaterThan(0);
  });

  it("is safe against SQL-injection-ish and pathological input", async () => {
    const f = await seedCatalogFixture();
    for (const q of [
      "'); drop table products;--",
      "\"; DELETE FROM variants; --",
      "a' OR '1'='1",
      "%_\\",
      "((((",
      "!!! & | <-> :*",
      "x".repeat(5000),
      "\u0000\u001f nul \u007f",
    ]) {
      await expect(search(q)).resolves.toBeDefined();
      await expect(quickSearch(db(), q)).resolves.toBeDefined();
    }
    const rows = await db().select().from(products);
    expect(rows.length).toBe(Object.keys(f.products).length);
    expect((await search("x".repeat(5000))).query.length).toBe(100);
  });

  it("applies filters, facets, sorting and paging to matches", async () => {
    await seedCatalogFixture();
    const charms = await search("charm", { sort: "price_asc" });
    expect(names(charms)).toEqual(["Heart Charm", "Skull Charm", "Spiky Charm"]);
    expect(charms.facets.types).toEqual([{ slug: "charms", name: "Charms", count: 3 }]);

    const bold = await search("charm", { vibes: ["bold"], sort: "price_desc" });
    expect(names(bold)).toEqual(["Spiky Charm", "Skull Charm"]);
    // disjunctive vibe facet still counts all matching vibes
    expect(bold.facets.vibes.map((v) => `${v.slug}:${v.count}`)).toEqual([
      "cute:1",
      "bold:2",
      "gothic:1",
    ]);

    const page = await search("charm", { sort: "price_asc", pageSize: 2, page: 2 });
    expect(names(page)).toEqual(["Spiky Charm"]);
    expect(page).toMatchObject({ total: 3, hasMore: false });

    const priced = await search("charm", { priceMinPaise: 15000, priceMaxPaise: 20000 });
    expect(names(priced)).toEqual(["Skull Charm"]);
  });

  it("inStockOnly excludes products whose stock is fully reserved", async () => {
    const f = await seedCatalogFixture();
    await reserve(f.variants.cat!, 3, 10);
    await reserve(f.variants.ghost!, 20, -10); // expired
    expect(names(await search("sticker", { inStockOnly: true }))).toEqual(["Ghost Sticker"]);
    expect(names(await search("sticker")).sort()).toEqual(["Cat Sticker", "Ghost Sticker"]);
  });

  it("featured sort in search behaves like relevance", async () => {
    await seedCatalogFixture();
    const a = await search("skull", { sort: "featured" });
    const b = await search("skull", { sort: "relevance" });
    expect(names(a)).toEqual(names(b));
  });
});

describe("quickSearch", () => {
  it("returns a short list of product cards plus matching collections", async () => {
    await seedCatalogFixture();
    const r = await quickSearch(db(), "gothic");
    expect(r.products.map((p) => p.name).sort()).toEqual(["Ghost Sticker", "Skull Charm"]);
    expect(r.collections).toEqual([{ kind: "vibe", slug: "gothic", name: "Gothic" }]);

    const limited = await quickSearch(db(), "charm", 2);
    expect(limited.products).toHaveLength(2);
    expect(limited.collections).toEqual([{ kind: "type", slug: "charms", name: "Charms" }]);

    expect(await quickSearch(db(), "")).toEqual({ query: "", products: [], collections: [] });
    expect((await quickSearch(db(), "skul")).products.map((p) => p.name)).toEqual(["Skull Charm"]);
  });
});
