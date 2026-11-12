import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CartLines } from "@/components/store/cart/CartLines";
import { EMPTY_CART_VIEW } from "@/components/store/cart/empty-cart";
import type { CartView, CartViewLine } from "@/features/cart/types";

const line = (over: Partial<CartViewLine>): CartViewLine => ({
  lineId: "v1",
  variantId: "v1",
  productId: "p1",
  productSlug: "star-charm",
  productName: "Star charm",
  variantTitle: "Default",
  sku: "ST-1",
  image: null,
  qty: 1,
  isDiyChain: false,
  unitPricePaise: 4900,
  mrpPaise: 4900,
  lineSubtotalPaise: 4900,
  discountAllocPaise: 0,
  lineTotalPaise: 4900,
  available: 10,
  maxQty: 10,
  lowStock: false,
  ...over,
});

const chain = (qty: number) =>
  line({
    lineId: "chain",
    variantId: "chain",
    productName: "DIY chain",
    productSlug: "diy-chain",
    sku: "IFO-DIY-CHAIN",
    isDiyChain: true,
    qty,
    unitPricePaise: 0,
    mrpPaise: 0,
    lineSubtotalPaise: 0,
    lineTotalPaise: 0,
  });

const render = (lines: CartViewLine[]) => {
  const cart: CartView = { ...EMPTY_CART_VIEW, lines, itemCount: lines.length };
  return renderToStaticMarkup(createElement(CartLines, { cart, onQuantity: () => {}, onRemove: () => {}, layout: "drawer" }));
};

describe("CartLines: the free DIY chain", () => {
  it("shows the chain as included and free, with no stepper, remove button or product link", () => {
    const html = render([line({}), chain(1)]);
    const row = html.slice(html.indexOf("data-diy-chain"));
    expect(row).toContain("DIY chain");
    expect(row).toContain("Included with your DIY pack");
    expect(row).toContain("Free");
    expect(row).not.toContain("Quantity of");
    expect(row).not.toContain("Remove DIY chain");
    expect(row).not.toContain("/products/diy-chain");
    // the charm keeps its usual controls and its price
    expect(html).toContain("Quantity of Star charm");
    expect(html).toContain("₹49");
  });

  it("says how many chains when there is more than one pack", () => {
    expect(render([line({ qty: 2 }), chain(2)])).toContain("× 2");
    expect(render([line({}), chain(1)])).not.toContain("×");
  });
});
