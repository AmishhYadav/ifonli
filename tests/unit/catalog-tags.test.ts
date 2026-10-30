import { describe, expect, it } from "vitest";

import {
  catalogInvalidationTags,
  listingTags,
  productSlugTag,
  productTag,
  stockInvalidationTags,
  stockTagsFor,
  typeCollectionTag,
  vibeCollectionTag,
} from "@/server/cache/tags";
import { SEARCH_QUERY_MAX_LENGTH, sanitizeSearchQuery } from "@/server/services/queries/shared";

describe("cache tags", () => {
  it("uses the documented scheme", () => {
    expect(productTag("p1")).toBe("product:p1");
    expect(productSlugTag("heart-charm")).toBe("product-slug:heart-charm");
    expect(vibeCollectionTag("gothic")).toBe("collection:vibe:gothic");
    expect(typeCollectionTag("charms")).toBe("collection:type:charms");
  });

  it("catalog invalidation always includes `catalog` for product-level changes", () => {
    expect(
      catalogInvalidationTags({
        productIds: ["p1"],
        productSlugs: ["old-slug", "new-slug"],
        vibeSlugs: ["cute"],
        typeSlugs: ["charms"],
      }).sort(),
    ).toEqual(
      [
        "catalog",
        "product:p1",
        "product-slug:old-slug",
        "product-slug:new-slug",
        "collection:vibe:cute",
        "collection:type:charms",
      ].sort(),
    );
  });

  it("a collection-only edit leaves `catalog` (and so unrelated lists) alone", () => {
    expect(catalogInvalidationTags({ vibeSlugs: ["gothic"] })).toEqual(["collection:vibe:gothic"]);
    expect(catalogInvalidationTags({})).toEqual([]);
  });

  it("de-duplicates and drops over-long tags", () => {
    const tags = catalogInvalidationTags({ productIds: ["a", "a"], vibeSlugs: ["x".repeat(300)] });
    expect(tags).toEqual(["catalog", "product:a"]);
  });

  it("listing tags cover scope, and stock per item or globally", () => {
    expect(listingTags({ vibes: ["gothic"], types: ["charms"] }, ["p1", "p2"]).sort()).toEqual(
      ["catalog", "collection:vibe:gothic", "collection:type:charms", "stock:p1", "stock:p2"].sort(),
    );
    expect(listingTags({ inStockOnly: true }, ["p1"])).toContain("stock");
    const many = Array.from({ length: 200 }, (_, i) => `p${i}`);
    expect(stockTagsFor(many)).toEqual(["stock"]);
    expect(listingTags({}, many).length).toBeLessThanOrEqual(128);
  });

  it("stock invalidation hits per-product and global tags", () => {
    expect(stockInvalidationTags(["p1", "p2"])).toEqual(["stock", "stock:p1", "stock:p2"]);
  });
});

describe("sanitizeSearchQuery", () => {
  it("strips control characters, collapses whitespace and trims", () => {
    expect(sanitizeSearchQuery("  skull \t\n charm\u0000\u0007 ")).toBe("skull charm");
  });

  it("caps at 100 characters", () => {
    expect(sanitizeSearchQuery("a".repeat(500))).toHaveLength(SEARCH_QUERY_MAX_LENGTH);
    expect(sanitizeSearchQuery(`${"a".repeat(99)} b`)).toBe("a".repeat(99));
  });

  it("normalises compatibility characters and non-strings", () => {
    expect(sanitizeSearchQuery("ｓｋｕｌｌ")).toBe("skull");
    expect(sanitizeSearchQuery(undefined)).toBe("");
    expect(sanitizeSearchQuery(42)).toBe("");
  });

  it("leaves SQL-looking text intact (it is only ever a bound parameter)", () => {
    expect(sanitizeSearchQuery("'); drop table products;--")).toBe("'); drop table products;--");
  });
});
