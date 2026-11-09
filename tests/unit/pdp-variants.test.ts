import { describe, expect, it } from "vitest";

import {
  clampQty,
  defaultVariantId,
  formatCalendarDate,
  formatDeliveryWindow,
  galleryOrder,
  imageIndexForVariant,
  landingVariantId,
  optionValueStates,
  pickVariant,
  stockStatus,
  variantForValues,
  type PdpModel,
} from "@/components/store/pdp/product-model";
import { markdownToPlainText, renderProductMarkdown, safeUrl } from "@/components/store/pdp/markdown";

const v = (id: string, ...optionValueIds: string[]) => ({
  id,
  title: id,
  optionValueIds,
  pricePaise: 10000,
  mrpPaise: 12000,
});

/** Colour x Size with a hole: red/L does not exist. */
const matrix: PdpModel = {
  productId: "p",
  name: "Thing",
  options: [
    {
      id: "colour",
      name: "Colour",
      values: [
        { id: "pink", value: "Pink", swatchHex: "#ff00aa" },
        { id: "red", value: "Red", swatchHex: null },
      ],
    },
    {
      id: "size",
      name: "Size",
      values: [
        { id: "s", value: "S", swatchHex: null },
        { id: "l", value: "L", swatchHex: null },
        { id: "xl", value: "XL", swatchHex: null },
      ],
    },
  ],
  variants: [v("pink-s", "pink", "s"), v("pink-l", "pink", "l"), v("red-s", "red", "s")],
};

describe("variant matrix", () => {
  it("defaults to the first variant and finds exact combinations", () => {
    expect(defaultVariantId(matrix)).toBe("pink-s");
    expect(variantForValues(matrix, ["l", "pink"])?.id).toBe("pink-l");
    expect(variantForValues(matrix, ["red", "l"])).toBeNull();
  });

  it("lands on the first in-stock variant when the default is sold out", () => {
    const stock = (...inStock: string[]) =>
      new Map(matrix.variants.map((x) => [x.id, { inStock: inStock.includes(x.id) }]));
    expect(landingVariantId(matrix, stock("pink-s", "red-s"), "pink-s")).toBe("pink-s");
    expect(landingVariantId(matrix, stock("red-s"), "pink-s")).toBe("red-s");
    expect(landingVariantId(matrix, stock("pink-l", "red-s"), "pink-s")).toBe("pink-l");
    // Nothing buyable, or no stock row for the current one: stay put.
    expect(landingVariantId(matrix, stock(), "pink-s")).toBe("pink-s");
    expect(landingVariantId(matrix, new Map(), "pink-s")).toBe("pink-s");
  });

  it("keeps the other option when the combination exists", () => {
    expect(pickVariant(matrix, "pink-s", "size", "l")?.id).toBe("pink-l");
    expect(pickVariant(matrix, "pink-s", "colour", "red")?.id).toBe("red-s");
  });

  it("moves to the nearest variant when the combination is missing", () => {
    // red + L has no variant: choosing L while red is selected lands on the only L variant.
    expect(pickVariant(matrix, "red-s", "size", "l")?.id).toBe("pink-l");
  });

  it("returns null for a value no variant has", () => {
    expect(pickVariant(matrix, "pink-s", "size", "xl")).toBeNull();
    expect(pickVariant(matrix, "pink-s", "nope", "xl")).toBeNull();
  });

  it("flags values: selected, disabled (no variant) and adjusts (missing combination)", () => {
    const [colour, size] = optionValueStates(matrix, "red-s");
    expect(colour!.values.find((x) => x.id === "red")).toMatchObject({ selected: true, disabled: false, adjusts: false });
    expect(size!.values.find((x) => x.id === "l")).toMatchObject({ selected: false, disabled: false, adjusts: true });
    expect(size!.values.find((x) => x.id === "xl")).toMatchObject({ disabled: true, variantId: null });
  });

  it("handles products without options", () => {
    const single: PdpModel = { productId: "p", name: "X", options: [], variants: [v("only")] };
    expect(defaultVariantId(single)).toBe("only");
    expect(optionValueStates(single, "only")).toEqual([]);
    expect(defaultVariantId({ ...single, variants: [] })).toBeNull();
  });
});

describe("gallery and stock helpers", () => {
  const img = (id: string, variantId: string | null) => ({
    id,
    variantId,
    src: "/x.png",
    alt: "",
    width: 1,
    height: 1,
    isCutout: false,
  });

  it("finds a variant's own image", () => {
    const images = [img("a", null), img("b", "pink-l")];
    expect(imageIndexForVariant(images, "pink-l")).toBe(1);
    expect(imageIndexForVariant(images, "red-s")).toBeNull();
    expect(imageIndexForVariant(images, null)).toBeNull();
  });

  it("shows the photos in order and leaves the cutout out when there are photos", () => {
    const photo = (id: string) => ({ ...img(id, null), isCutout: false });
    const cut = (id: string) => ({ ...img(id, null), isCutout: true });
    expect(galleryOrder([photo("p1"), cut("c1"), photo("p2"), cut("c2")]).map((i) => i.id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(galleryOrder([cut("c1")]).map((i) => i.id)).toEqual(["c1"]);
    expect(galleryOrder([photo("p1"), photo("p2")]).map((i) => i.id)).toEqual(["p1", "p2"]);
    expect(galleryOrder([])).toEqual([]);
  });

  it("words the stock status from the server's flags", () => {
    expect(stockStatus(undefined)).toBeNull();
    expect(stockStatus({ inStock: false, lowStock: false, available: 0 })?.kind).toBe("sold_out");
    expect(stockStatus({ inStock: true, lowStock: true, available: 3 })).toEqual({ kind: "low", label: "Only 3 left" });
    expect(stockStatus({ inStock: true, lowStock: false, available: 40 })?.label).toBe("In stock");
  });

  it("clamps quantity to what can be bought", () => {
    expect(clampQty(5, 3)).toBe(3);
    expect(clampQty(0, 3)).toBe(1);
    expect(clampQty(2, 0)).toBe(0);
    expect(clampQty(Number.NaN, 4)).toBe(1);
  });

  it("formats delivery dates without shifting the day", () => {
    expect(formatCalendarDate("2026-11-04")).toBe("Wed, 4 Nov");
    expect(formatDeliveryWindow("2026-11-04", "2026-11-04")).toBe("Wed, 4 Nov");
    expect(formatDeliveryWindow("2026-11-04", "2026-11-06")).toBe("Wed, 4 Nov to Fri, 6 Nov");
  });
});

describe("product Markdown", () => {
  it("renders formatting", () => {
    const html = renderProductMarkdown("Hello **world**\n\n- one\n- two");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<li>one</li>");
  });

  it("escapes raw HTML instead of passing it through", () => {
    const html = renderProductMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops unsafe link and image URLs, keeps safe ones", () => {
    expect(renderProductMarkdown("[x](javascript:alert(1))")).not.toContain("href");
    expect(renderProductMarkdown("[x](java\tscript:alert(1))")).not.toContain("javascript");
    expect(renderProductMarkdown("![a](data:text/html;base64,AAAA)")).not.toContain("<img");
    const ok = renderProductMarkdown("[shop](https://example.com/a?b=1&c=2) [rel](/shop)");
    expect(ok).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(ok).toContain('rel="nofollow noopener noreferrer"');
    expect(ok).toContain('href="/shop"');
  });

  it("validates URLs and strips Markdown for meta text", () => {
    expect(safeUrl("https://a.b")).toBe("https://a.b");
    expect(safeUrl("//evil.com")).toBeNull();
    expect(safeUrl("JaVaScRiPt:1")).toBeNull();
    expect(markdownToPlainText("# Hi\n\nA **bold** [link](/x) claim.")).toBe("Hi A bold link claim.");
    expect(markdownToPlainText("x".repeat(400), 50)).toHaveLength(50);
  });
});
