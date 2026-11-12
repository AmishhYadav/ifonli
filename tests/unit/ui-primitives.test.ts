import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToastProvider } from "@/components/ui/Toast";
import { ProductCardView } from "@/components/store/ProductCardView";
import { Button, IconButton } from "@/components/ui/Button";
import { ICON_NAMES } from "@/components/ui/Icon";
import { Price, discountPercent } from "@/components/ui/Price";
import { cn } from "@/lib/cn";
import type { ProductCard } from "@/server/services/queries/types";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("cn", () => {
  it("merges conflicting Tailwind utilities and drops falsy values", () => {
    expect(cn("px-2 py-1", false && "hidden", "px-4")).toBe("py-1 px-4");
  });
});

describe("icon sprite", () => {
  it("ICON_NAMES matches the symbols in public/icons/sprite.svg", () => {
    const sprite = readFileSync("public/icons/sprite.svg", "utf8");
    const symbols = [...sprite.matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].map((m) => m[1]).sort();
    expect([...ICON_NAMES].sort()).toEqual(symbols);
  });
});

describe("Price", () => {
  it("strikes through the MRP only when the price is lower", () => {
    expect(html(createElement(Price, { pricePaise: 34900, mrpPaise: 44900 }))).toContain("<s ");
    expect(html(createElement(Price, { pricePaise: 34900, mrpPaise: 34900 }))).not.toContain("<s ");
    expect(html(createElement(Price, { pricePaise: 34900, mrpPaise: 20000 }))).not.toContain("<s ");
    expect(html(createElement(Price, { pricePaise: 34900, mrpPaise: null }))).not.toContain("<s ");
  });

  it("formats paise as INR and supports From / tax note / discount", () => {
    const out = html(
      createElement(Price, {
        pricePaise: 34900,
        mrpPaise: 49900,
        from: true,
        inclusiveOfTaxes: true,
        showDiscount: true,
      }),
    );
    expect(out).toContain("₹349");
    expect(out).toContain("₹499");
    expect(out).toContain("From");
    expect(out).toContain("incl. of all taxes");
    expect(out).toContain("30% off");
    expect(html(createElement(Price, { pricePaise: 34900 }))).not.toContain("From");
  });

  it("says MRP in the tax line when the price equals the MRP (no strike-through to carry the word)", () => {
    const same = html(createElement(Price, { pricePaise: 17900, mrpPaise: 17900, inclusiveOfTaxes: true }));
    expect(same).toContain("MRP incl. of all taxes");
    expect(same).not.toMatch(/<s[ >]/);
    const discounted = html(createElement(Price, { pricePaise: 14900, mrpPaise: 17900, inclusiveOfTaxes: true }));
    expect(discounted).toMatch(/<s[ >]/);
    expect(discounted).not.toContain("MRP incl. of all taxes");
    const cardLayout = html(createElement(Price, { pricePaise: 17900, mrpPaise: 17900 }));
    expect(cardLayout).not.toContain("MRP incl.");
  });

  it("never reports a discount without a real MRP above the price", () => {
    expect(discountPercent(100, 100)).toBe(0);
    expect(discountPercent(100, 50)).toBe(0);
    expect(discountPercent(100, undefined)).toBe(0);
    expect(discountPercent(75, 100)).toBe(25);
  });
});

describe("Button", () => {
  it("is a type=button by default and exposes loading as aria-busy", () => {
    const out = html(createElement(Button, { loading: true }, "Pay"));
    expect(out).toContain('type="button"');
    expect(out).toContain('aria-busy="true"');
    expect(html(createElement(Button, null, "Pay"))).not.toContain("aria-busy");
  });

  it("IconButton carries its accessible label", () => {
    const out = html(createElement(IconButton, { icon: "search", label: "Search" }));
    expect(out).toContain('aria-label="Search"');
  });
});

const base: ProductCard = {
  id: "1",
  slug: "heart-charm",
  name: "Heart charm",
  typeSlug: "charm",
  typeName: "Charm",
  vibeSlugs: ["cute"],
  primaryVibe: "cute",
  priceFromPaise: 34900,
  mrpFromPaise: 34900,
  hasPriceRange: false,
  inStock: true,
  lowStock: false,
  quickAddVariantId: null,
  image: null,
  cutout: null,
};
const card = (p: Partial<ProductCard>) =>
  html(createElement(ProductCardView, { product: { ...base, ...p }, image: null, isCutout: false }));

describe("ProductCardView", () => {
  it("links the whole card to the product page", () => {
    expect(card({})).toContain('href="/products/heart-charm"');
  });

  it("shows Low stock only when lowStock, Sold out when out of stock (still linked)", () => {
    expect(card({})).not.toContain("Low stock");
    expect(card({ lowStock: true })).toContain("Low stock");
    const sold = card({ inStock: false, lowStock: true });
    expect(sold).toContain("Sold out");
    expect(sold).not.toContain(">Low stock<");
    expect(sold).toContain('href="/products/heart-charm"');
  });

  it("prefixes From for variable prices and never strikes an equal MRP", () => {
    expect(card({ hasPriceRange: true })).toContain("From");
    // several variants at one price: the card is not a range, so no "From"
    expect(card({ hasPriceRange: false, priceFromPaise: 17900, mrpFromPaise: 17900 })).not.toContain("From");
    expect(card({})).not.toContain("From");
    expect(card({})).not.toContain("<s ");
    expect(card({ mrpFromPaise: 44900 })).toContain("<s ");
  });

  it("shows the rounded percent off next to a struck MRP, and none for an equal MRP", () => {
    expect(card({ priceFromPaise: 31800, mrpFromPaise: 50000 })).toContain("(36% OFF)");
    expect(card({})).not.toContain("OFF)");
  });

  it("quick action: Choose options for several variants, a disabled Sold out, else Add to bag", () => {
    const choose = card({ quickAddVariantId: null });
    expect(choose).toContain("Choose options");
    expect(choose).not.toContain("quick-add");
    const sold = card({ inStock: false, quickAddVariantId: null });
    expect(sold).toMatch(/<button[^>]*disabled[^>]*>Sold out<\/button>/);
    const add = html(
      createElement(ToastProvider, null, createElement(ProductCardView, {
        product: { ...base, quickAddVariantId: "v1" },
        image: null,
        isCutout: false,
      })),
    );
    expect(add).toContain('data-testid="quick-add"');
    expect(add).toContain("Add to bag");
  });

  it("on the DIY page the action is Add to kit, in place of Add to bag", () => {
    const kit = html(
      createElement(ToastProvider, null, createElement(ProductCardView, {
        product: { ...base, quickAddVariantId: "v1" },
        image: null,
        isCutout: false,
        kit: true,
      })),
    );
    expect(kit).toContain('data-testid="kit-add"');
    expect(kit).toContain("Add to kit");
    expect(kit).not.toContain("Add to bag");
    // a sold-out charm cannot be picked
    expect(
      html(createElement(ToastProvider, null, createElement(ProductCardView, { product: { ...base, inStock: false, quickAddVariantId: "v1" }, image: null, isCutout: false, kit: true }))),
    ).not.toContain("kit-add");
  });

  it("the image tile wears the product's vibe gradient (neutral without one)", () => {
    expect(card({ primaryVibe: "gothic" })).toContain("art-gothic");
    expect(card({ primaryVibe: null })).toContain("art-none");
  });
});
