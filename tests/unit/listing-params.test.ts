import { describe, expect, it } from "vitest";

import {
  MAX_PAGE,
  PAGE_SIZE,
  activeFilterCount,
  buildListingHref,
  parseListingQuery,
  toListProductsParams,
  type KnownValues,
} from "@/components/store/listing/params";

const known: KnownValues = {
  vibes: ["cute", "funky", "bold", "gothic"],
  types: ["charms", "hippers", "3d-stickers", "diy-accessories"],
  madeIn: ["India", "Nepal"],
};

const parse = (raw: Record<string, string | string[] | undefined>, search = false) =>
  parseListingQuery(raw, known, { search });

describe("parseListingQuery", () => {
  it("returns defaults for an empty URL", () => {
    expect(parse({})).toEqual({
      vibes: [],
      types: [],
      minRupees: null,
      maxRupees: null,
      inStock: false,
      madeIn: [],
      sort: "featured",
      page: 1,
    });
  });

  it("defaults the search sort to relevance and only accepts it there", () => {
    expect(parse({}, true).sort).toBe("relevance");
    expect(parse({ sort: "relevance" }, true).sort).toBe("relevance");
    expect(parse({ sort: "relevance" }).sort).toBe("featured");
  });

  it("drops unknown vibes, types, countries and sorts", () => {
    const q = parse({
      vibes: "gothic,nope,<script>",
      types: ["charms", "evil"],
      made: "India,Narnia",
      sort: "price; drop table",
    });
    expect(q.vibes).toEqual(["gothic"]);
    expect(q.types).toEqual(["charms"]);
    expect(q.madeIn).toEqual(["India"]);
    expect(q.sort).toBe("featured");
  });

  it("accepts repeated and comma-separated values, case-insensitively, deduped and in catalogue order", () => {
    const q = parse({ vibes: ["GOTHIC,cute", "cute", "bold"], made: "india" });
    expect(q.vibes).toEqual(["cute", "bold", "gothic"]);
    expect(q.madeIn).toEqual(["India"]);
  });

  it("does not let the theme param ?vibe= act as a filter", () => {
    expect(parse({ vibe: "gothic" }).vibes).toEqual([]);
  });

  it("parses prices as whole rupees and swaps an inverted range", () => {
    expect(parse({ min: "100", max: "500" })).toMatchObject({ minRupees: 100, maxRupees: 500 });
    expect(parse({ min: "900", max: "100" })).toMatchObject({ minRupees: 100, maxRupees: 900 });
    expect(parse({ min: "-5", max: "abc" })).toMatchObject({ minRupees: null, maxRupees: null });
    expect(parse({ min: "12.5" }).minRupees).toBeNull();
    expect(parse({ max: "99999999999" }).maxRupees).toBeNull();
  });

  it("reads stock and bounds the page", () => {
    expect(parse({ stock: "1" }).inStock).toBe(true);
    expect(parse({ stock: "0" }).inStock).toBe(false);
    expect(parse({ page: "3" }).page).toBe(3);
    expect(parse({ page: "0" }).page).toBe(1);
    expect(parse({ page: "-4" }).page).toBe(1);
    expect(parse({ page: "nan" }).page).toBe(1);
    expect(parse({ page: "9999" }).page).toBe(MAX_PAGE);
  });

  it("caps the length of list values so a hostile URL cannot mint cache keys", () => {
    const long = "a".repeat(500);
    expect(parse({ vibes: long }).vibes).toEqual([]);
  });
});

describe("toListProductsParams", () => {
  it("converts rupees to paise and omits unset filters (stable cache key)", () => {
    const q = parse({ types: "charms", min: "100", max: "500", stock: "1" });
    expect(toListProductsParams(q)).toEqual({
      types: ["charms"],
      priceMinPaise: 10000,
      priceMaxPaise: 50000,
      inStockOnly: true,
      sort: "featured",
      page: 1,
      pageSize: PAGE_SIZE,
    });
    expect(Object.keys(toListProductsParams(parse({})))).toEqual(["sort", "page", "pageSize"]);
  });

  it("pins the collection dimension and ignores a conflicting URL filter", () => {
    const q = parse({ vibes: "bold,cute", types: "hippers" });
    const params = toListProductsParams(q, { vibe: "gothic" });
    expect(params.vibes).toEqual(["gothic"]);
    expect(params.types).toEqual(["hippers"]);
    expect(toListProductsParams(q, { type: "charms" }).types).toEqual(["charms"]);
  });

  it("takes an explicit page", () => {
    expect(toListProductsParams(parse({ page: "4" }), {}, 2).page).toBe(2);
  });
});

describe("buildListingHref", () => {
  it("omits defaults and page 1", () => {
    expect(buildListingHref("/shop", parse({}))).toBe("/shop");
    expect(buildListingHref("/shop", parse({ page: "1", sort: "featured" }))).toBe("/shop");
  });

  it("round-trips through parse", () => {
    const q = parse({ vibes: "cute,gothic", types: "charms", min: "100", max: "400", stock: "1", made: "India", sort: "price_asc", page: "2" });
    const href = buildListingHref("/shop", q);
    expect(href).toBe(
      "/shop?vibes=cute,gothic&types=charms&min=100&max=400&stock=1&made=India&sort=price_asc&page=2",
    );
    const url = new URL(href, "http://x");
    expect(parse(Object.fromEntries(url.searchParams))).toEqual(q);
  });

  it("keeps the search term and its default sort", () => {
    expect(buildListingHref("/search", parse({ q: "x" }, true), { search: true, q: "skull cap" })).toBe(
      "/search?q=skull%20cap",
    );
    expect(buildListingHref("/search", { sort: "newest" }, { search: true, q: "a" })).toBe(
      "/search?q=a&sort=newest",
    );
  });

  it("never emits the theme param", () => {
    expect(buildListingHref("/shop", parse({ vibe: "gothic", vibes: "bold" }))).not.toContain("vibe=");
  });
});

describe("activeFilterCount", () => {
  it("counts filters and ignores the pinned collection dimension", () => {
    const q = parse({ vibes: "gothic", types: "charms,hippers", min: "10", max: "20", stock: "1" });
    expect(activeFilterCount(q)).toBe(5);
    expect(activeFilterCount(q, { vibe: "gothic" })).toBe(4);
    expect(activeFilterCount(q, { type: "charms" })).toBe(3);
  });
});
