import { describe, expect, it } from "vitest";

import {
  applyOptimistic,
  isFreeShippingPincode,
  shippingNote,
  shippingValue,
  withPincodeShipping,
} from "@/components/store/cart/cart-math";
import { EMPTY_CART_VIEW } from "@/components/store/cart/empty-cart";
import type { CartView, CartViewLine } from "@/features/cart/types";

const line = (id: string, unit: number, qty: number, discountAllocPaise = 0): CartViewLine => ({
  lineId: id,
  variantId: id,
  productId: "p",
  productSlug: "p",
  productName: id,
  variantTitle: "Default",
  sku: id,
  image: null,
  qty,
  isDiyChain: false,
  unitPricePaise: unit,
  mrpPaise: unit,
  lineSubtotalPaise: unit * qty,
  discountAllocPaise,
  lineTotalPaise: unit * qty - discountAllocPaise,
  available: 10,
  maxQty: 10,
  lowStock: false,
});

function cart(lines: CartViewLine[], over: Partial<CartView["pricing"]> = {}): CartView {
  const subtotal = lines.reduce((s, l) => s + l.lineSubtotalPaise, 0);
  const discount = over.discountPaise ?? 0;
  const shipping = over.shippingPaise ?? 4900;
  const total = subtotal - discount + shipping;
  return {
    ...EMPTY_CART_VIEW,
    cartId: "c",
    version: 3,
    lines,
    itemCount: lines.reduce((s, l) => s + l.qty, 0),
    canCheckout: true,
    pricing: {
      ...EMPTY_CART_VIEW.pricing,
      subtotalPaise: subtotal,
      discountPaise: discount,
      shippingPaise: shipping,
      totalPaise: total,
      taxIncludedPaise: Math.round(total * 0.1),
      ...over,
    },
  };
}

describe("applyOptimistic", () => {
  it("recomputes line, subtotal, item count and total for a quantity change", () => {
    const next = applyOptimistic(cart([line("a", 10000, 1), line("b", 5000, 2)]), { type: "qty", variantId: "a", qty: 3 });
    expect(next.lines[0]).toMatchObject({ qty: 3, lineSubtotalPaise: 30000 });
    expect(next.pricing.subtotalPaise).toBe(40000);
    expect(next.itemCount).toBe(5);
    expect(next.pricing.totalPaise).toBe(40000 + 4900);
  });

  it("removes a line and empties the totals when it was the last one", () => {
    const two = cart([line("a", 10000, 1), line("b", 5000, 2)]);
    const one = applyOptimistic(two, { type: "remove", variantId: "a" });
    expect(one.lines.map((l) => l.variantId)).toEqual(["b"]);
    expect(one.pricing.subtotalPaise).toBe(10000);
    const none = applyOptimistic(one, { type: "remove", variantId: "b" });
    expect(none.lines).toEqual([]);
    expect(none.pricing.totalPaise).toBe(0);
    expect(none.canCheckout).toBe(false);
  });

  it("never lets the discount exceed the subtotal and does not mutate its input", () => {
    const before = cart([line("a", 10000, 2)], { discountPaise: 15000 });
    const snapshot = JSON.stringify(before);
    const next = applyOptimistic(before, { type: "qty", variantId: "a", qty: 1 });
    expect(next.pricing.discountPaise).toBe(10000);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("shipping wording", () => {
  const base = EMPTY_CART_VIEW.pricing;
  it("shows Free / the fee / a dash", () => {
    expect(shippingValue({ ...base, shippingPaise: 0 }, true)).toBe("Free");
    expect(shippingValue({ ...base, shippingPaise: 4900 }, true)).toBe("₹49");
    expect(shippingValue(base, false)).toBe("-");
  });

  it("states the free-shipping threshold without urgency", () => {
    expect(shippingNote(base)).toBeNull();
    expect(shippingNote({ ...base, freeThresholdPaise: 49900, freeShippingRemainingPaise: 10000 })).toBe(
      "Free shipping above ₹499. Add ₹100 more.",
    );
    expect(shippingNote({ ...base, freeThresholdPaise: 49900, freeShippingRemainingPaise: 0 })).toBe(
      "You've unlocked free shipping.",
    );
  });
});

describe("free-shipping pincode estimate", () => {
  const base = {
    ...EMPTY_CART_VIEW.pricing,
    freeShippingPincodes: ["560064"],
    freeThresholdPaise: 19900,
    freeShippingRemainingPaise: 10000,
    shippingPaise: 4900,
    totalPaise: 14900,
    messages: ["Add ₹100 more for free shipping"],
  };

  it("recognises only exact listed pincodes", () => {
    expect(isFreeShippingPincode(base, "560064")).toBe(true);
    expect(isFreeShippingPincode(base, "560065")).toBe(false);
    expect(isFreeShippingPincode(base, null)).toBe(false);
    expect(isFreeShippingPincode(base, "")).toBe(false);
  });

  it("shows shipping as free and drops the nag once the pincode is known", () => {
    expect(shippingValue(base, true, "560064")).toBe("Free");
    expect(shippingValue(base, true, "560001")).toBe("₹49");
    expect(shippingValue(base, true)).toBe("₹49");
    expect(shippingNote(base, "560064")).toBe("Free shipping to your pincode.");
    expect(shippingNote(base, "560001")).toBe("Free shipping above ₹199. Add ₹100 more.");
  });

  it("withPincodeShipping zeroes the fee, takes it off the total and clears the progress text", () => {
    expect(withPincodeShipping(base, "560064")).toMatchObject({
      shippingPaise: 0,
      totalPaise: 10000,
      freeShippingRemainingPaise: 0,
      messages: [],
    });
    expect(withPincodeShipping(base, "560001")).toBe(base);
  });
});
