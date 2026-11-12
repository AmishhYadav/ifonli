import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { getCheckoutQuote, lookupPincodeForCheckout } from "@/server/services/checkout";
import { loadCommerceSettings } from "@/server/services/commerce/settings";
import { quoteLines, loadVariantSnapshots, toCartLine } from "@/server/services/pricing";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, makeCart, makeCoupon, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
let f: Fixture;

// Monday 2 Nov 2026, 10:00 IST
const NOW = new Date("2026-11-02T04:30:00Z");

beforeEach(async () => {
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});

async function quote(
  items: { variantId: string; qty: number }[],
  req: Parameters<typeof getCheckoutQuote>[2] = {},
  cartOpts: Parameters<typeof makeCart>[1] = {},
) {
  const cart = await makeCart(items, cartOpts);
  return getCheckoutQuote(db(), cart.id, { now: NOW, ...req });
}

describe("getCheckoutQuote: free-shipping pincodes", () => {
  beforeEach(async () => {
    const { pincodes } = await import("@/server/db/schema");
    await db()
      .insert(pincodes)
      .values({ pincode: "560064", district: "Bengaluru", stateCode: "29", zone: "rest_of_india" });
  });

  it("ships free to a listed pincode below the threshold, with no free-shipping nag", async () => {
    const q = await quote([{ variantId: f.variants.ghost!, qty: 1 }], { pincode: "560064" }); // 129
    expect(q.pricing).toMatchObject({
      subtotalPaise: 12900,
      shippingPaise: 0,
      totalPaise: 12900,
      freeShippingRemainingPaise: 0,
      messages: ["Free shipping to your pincode."],
    });
    expect(q.cart.pricing.freeShippingPincodes).toEqual(["560064"]);
    expect(q.canPlaceOrder).toBe(true);
  });

  it("still charges shipping to any other pincode and before a pincode is entered", async () => {
    const other = await quote([{ variantId: f.variants.ghost!, qty: 1 }], { pincode: "560001" });
    expect(other.pricing).toMatchObject({ shippingPaise: 5000, totalPaise: 17900 });
    const none = await quote([{ variantId: f.variants.ghost!, qty: 1 }]);
    expect(none.pricing.shippingPaise).toBe(5000);
  });

  it("is driven by the setting: removing the pincode restores the fee; COD fee stays", async () => {
    await configureCommerce({ free_shipping_pincodes: ["560001"] });
    const old = await quote([{ variantId: f.variants.ghost!, qty: 1 }], { pincode: "560064" });
    expect(old.pricing.shippingPaise).toBe(5000);
    const nowFree = await quote([{ variantId: f.variants.ghost!, qty: 1 }], {
      pincode: "560001",
      paymentMethod: "cod",
    });
    expect(nowFree.pricing).toMatchObject({ shippingPaise: 0, codFeePaise: 4000, totalPaise: 12900 + 4000 });
  });
});

describe("getCheckoutQuote: totals", () => {
  it("prices prepaid with flat shipping below the threshold and a GST breakup that adds up", async () => {
    const q = await quote([{ variantId: f.variants.ghost!, qty: 2 }], { pincode: "400001" }); // 258
    expect(q.pricing).toMatchObject({
      subtotalPaise: 25800,
      discountPaise: 0,
      shippingPaise: 5000,
      codFeePaise: 0,
      totalPaise: 30800,
      freeShippingRemainingPaise: 24200,
    });
    // 18% inclusive: lines 25800 -> tax 3936, shipping 5000 -> tax 763
    expect(q.pricing.taxIncludedPaise).toBe(3936 + 763);
    // Store and buyer are both Maharashtra: CGST + SGST, no IGST
    expect(q.pricing.gst).toEqual({ cgst: 1968 + 381, sgst: 1968 + 382, igst: 0 });
    expect(q.paymentMethod).toBe("razorpay");
    expect(q.payment.razorpay).toEqual({ available: true, totalPaise: 30800 });
    expect(q.blockers).toEqual([]);
    expect(q.canPlaceOrder).toBe(true);
  });

  it("uses IGST for another state", async () => {
    const q = await quote([{ variantId: f.variants.ghost!, qty: 2 }], { pincode: "110001" });
    expect(q.pricing.gst).toEqual({ cgst: 0, sgst: 0, igst: q.pricing.taxIncludedPaise });
  });

  it("makes shipping free once the discounted subtotal reaches the threshold", async () => {
    const q = await quote([{ variantId: f.variants.ghost!, qty: 4 }], { pincode: "400001" }); // 516
    expect(q.pricing).toMatchObject({ subtotalPaise: 51600, shippingPaise: 0, totalPaise: 51600 });
    expect(q.pricing.messages).toEqual(["You've unlocked free shipping."]);
  });

  it("adds the COD fee as its own line for COD and keeps both totals visible", async () => {
    const q = await quote(
      [{ variantId: f.variants.ghost!, qty: 2 }],
      { pincode: "400001", paymentMethod: "cod" },
    );
    expect(q.paymentMethod).toBe("cod");
    expect(q.pricing).toMatchObject({ shippingPaise: 5000, codFeePaise: 4000, totalPaise: 34800 });
    expect(q.payment.cod).toEqual({ available: true, reason: null, feePaise: 4000, totalPaise: 34800 });
    expect(q.payment.razorpay.totalPaise).toBe(30800);
    // the COD fee carries GST too (dominant 18%): 4000 -> 610 on top of 3936 + 763
    expect(q.pricing.taxIncludedPaise).toBe(3936 + 763 + 610);
  });

  it("applies a zone shipping override from the pincode's zone", async () => {
    await configureCommerce({ zone_overrides: { metro_region: 9000 } });
    const delhi = await quote([{ variantId: f.variants.ghost!, qty: 1 }], { pincode: "110001" });
    expect(delhi.pricing.shippingPaise).toBe(9000);
    const mumbai = await quote([{ variantId: f.variants.ghost!, qty: 1 }], { pincode: "400001" });
    expect(mumbai.pricing.shippingPaise).toBe(5000);
  });

  it("applies coupons: percent discount, free-shipping coupon, and an unmet minimum", async () => {
    await makeCoupon({ code: "SAVE10", kind: "percent", value: 1000 });
    await makeCoupon({ code: "SHIP0", kind: "free_shipping", value: 0 });
    await makeCoupon({ code: "BIG", minSubtotalPaise: 100000 });
    const item = [{ variantId: f.variants.ghost!, qty: 2 }];

    const pct = await quote(item, { pincode: "400001" }, { couponCode: "SAVE10" });
    expect(pct.coupon).toEqual({ code: "SAVE10", applied: true, message: null, rejectCode: null });
    expect(pct.pricing).toMatchObject({ discountPaise: 2580, totalPaise: 25800 - 2580 + 5000 });
    expect(pct.pricing.lines[0]).toMatchObject({ discountAllocPaise: 2580, lineTotalPaise: 23220 });

    const ship = await quote(item, { pincode: "400001", paymentMethod: "cod" }, { couponCode: "SHIP0" });
    expect(ship.pricing).toMatchObject({ shippingPaise: 0, codFeePaise: 4000, totalPaise: 25800 + 4000 });

    const big = await quote(item, { pincode: "400001" }, { couponCode: "BIG" });
    expect(big.coupon).toMatchObject({ applied: false, rejectCode: "min_subtotal" });
    expect(big.blockers).toContain("Add ₹742 more to use BIG");
    expect(big.canPlaceOrder).toBe(false);
  });
});

describe("getCheckoutQuote: serviceability", () => {
  it("needs a pincode; unknown, malformed and unserviceable ones block with human text", async () => {
    const item = [{ variantId: f.variants.cat!, qty: 1 }];
    const none = await quote(item);
    expect(none.pincode).toBeNull();
    expect(none.blockers).toEqual(["Enter your delivery pincode."]);
    expect(none.canPlaceOrder).toBe(false);

    const unknown = await quote(item, { pincode: "999999" });
    expect(unknown.pincode).toMatchObject({ status: "unknown", serviceable: false });
    expect(unknown.blockers).toEqual(["We couldn't find that pincode. Please check it and try again."]);

    const bad = await quote(item, { pincode: "12ab" });
    expect(bad.pincode).toMatchObject({ status: "invalid" });
    expect(bad.blockers).toEqual(["Enter a valid 6-digit pincode."]);

    const island = await quote(item, { pincode: "744101" });
    expect(island.pincode).toMatchObject({ status: "unserviceable", serviceable: false });
    expect(island.blockers).toEqual(["Sorry, we can't deliver to 744101 yet."]);
  });

  it("autofills city and state, and estimates delivery in working days", async () => {
    const q = await quote([{ variantId: f.variants.cat!, qty: 1 }], { pincode: "400001" });
    expect(q.pincode).toMatchObject({
      status: "ok",
      city: "Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      zone: "rest_of_india",
      serviceable: true,
      codAllowed: true,
    });
    // Mon 2 Nov + 1 processing + 3..6 transit working days, Sundays skipped
    expect(q.delivery).toEqual({ fromDate: "2026-11-06", toDate: "2026-11-10" });

    const delhi = await quote([{ variantId: f.variants.cat!, qty: 1 }], { pincode: "110001" });
    expect(delhi.delivery).toEqual({ fromDate: "2026-11-05", toDate: "2026-11-07" });
  });

  it("has no estimate when the zone has no configured range", async () => {
    await configureCommerce({ delivery_estimates_by_zone: {} });
    const q = await quote([{ variantId: f.variants.cat!, qty: 1 }], { pincode: "400001" });
    expect(q.delivery).toBeNull();
  });
});

describe("getCheckoutQuote: COD eligibility (plan 7.9)", () => {
  const item = () => [{ variantId: f.variants.ghost!, qty: 1 }];

  it("is blocked by the master switch", async () => {
    await configureCommerce({ cod_enabled: false });
    const q = await quote(item(), { pincode: "400001", paymentMethod: "cod" });
    expect(q.payment.cod).toMatchObject({
      available: false,
      reason: "Cash on delivery isn't available right now.",
    });
    expect(q.paymentMethod).toBe("razorpay"); // falls back to prepaid pricing
    expect(q.pricing.codFeePaise).toBe(0);
    expect(q.blockers).toEqual(["Cash on delivery isn't available right now."]);
    expect(q.canPlaceOrder).toBe(false);
  });

  it("is blocked by the pincode flag and by the excluded-pincodes setting", async () => {
    const pune = await quote(item(), { pincode: "411001", paymentMethod: "cod" });
    expect(pune.payment.cod.available).toBe(false);
    expect(pune.payment.cod.reason).toBe(
      "Cash on delivery isn't available for this pincode. You can pay online instead.",
    );
    expect(pune.pincode).toMatchObject({ serviceable: true, codAllowed: false });

    await configureCommerce({ cod_excluded_pincodes: ["400001"] });
    const mumbai = await quote(item(), { pincode: "400001", paymentMethod: "cod" });
    expect(mumbai.payment.cod.available).toBe(false);
    expect(mumbai.pincode?.codAllowed).toBe(false);
    // prepaid is still fine
    const prepaid = await quote(item(), { pincode: "400001", paymentMethod: "razorpay" });
    expect(prepaid.canPlaceOrder).toBe(true);
  });

  it("allows an order up to the maximum (COD fee included, plan 7.9) and blocks above it", async () => {
    // ghost x1 = 129 + 50 shipping = 179, plus the 40 COD fee = 219 payable
    await configureCommerce({ cod_max_order_value: 21900 });
    const atMax = await quote(item(), { pincode: "400001", paymentMethod: "cod" });
    expect(atMax.payment.cod.available).toBe(true);
    expect(atMax.pricing.totalPaise).toBe(17900 + 4000);

    await configureCommerce({ cod_max_order_value: 21899 });
    const over = await quote(item(), { pincode: "400001", paymentMethod: "cod" });
    expect(over.payment.cod).toMatchObject({
      available: false,
      reason: "Cash on delivery is available for orders up to ₹218.99.",
    });
    expect(over.payment.cod.totalPaise).toBe(17900 + 4000); // still shown for reference
  });

  it("treats a cod_max_order_value of 0 as no COD", async () => {
    await configureCommerce({ cod_max_order_value: 0 });
    const q = await quote(item(), { pincode: "400001", paymentMethod: "cod" });
    expect(q.payment.cod.available).toBe(false);
  });
});

describe("getCheckoutQuote: cart handling", () => {
  it("blocks an empty cart", async () => {
    const q = await quote([], { pincode: "400001" });
    expect(q.blockers).toContain("Your bag is empty.");
    expect(q.canPlaceOrder).toBe(false);
  });

  it("re-validates the cart and reports notices", async () => {
    const q = await quote([{ variantId: f.variants.cat!, qty: 9 }], { pincode: "400001" }); // 3 in stock
    expect(q.cart.lines[0]!.qty).toBe(3);
    expect(q.cart.notices[0]).toMatchObject({ code: "qty_reduced" });
    expect(q.pricing.subtotalPaise).toBe(29700);
  });
});

describe("quoteLines", () => {
  it("is the single function: same lines, same answer, with or without preloaded settings", async () => {
    const snaps = await loadVariantSnapshots(db(), [f.variants.skull!]);
    const settings = await loadCommerceSettings(db());
    const lines = [toCartLine(snaps.get(f.variants.skull!)!, 2, settings)];
    const a = await quoteLines(db(), { lines, pincode: "400001", paymentMethod: "cod" });
    const b = await quoteLines(db(), { lines, pincode: "400001", paymentMethod: "cod", settings, now: NOW });
    expect(a.price).toEqual(b.price);
    // skull has its own 3% GST rate; shipping/COD use the dominant (3%) rate
    expect(a.price.lines[0]).toMatchObject({ gstRateBp: 300, unitPricePaise: 19900 });
    expect(a.price.totalPaise).toBe(39800 + 5000 + 4000);
  });
});

describe("lookupPincodeForCheckout", () => {
  it("reports status without throwing for junk", async () => {
    const settings = await loadCommerceSettings(db());
    expect(await lookupPincodeForCheckout(db(), "560001", settings)).toMatchObject({
      status: "ok",
      city: "Bangalore",
      state: "Karnataka",
    });
    expect(await lookupPincodeForCheckout(db(), "", settings)).toMatchObject({ status: "invalid" });
    expect(await lookupPincodeForCheckout(db(), "1' OR 1=1 --", settings)).toMatchObject({
      status: "invalid",
      city: null,
    });
  });
});
