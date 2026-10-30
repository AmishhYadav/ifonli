import { describe, expect, it } from "vitest";

import {
  allocateDiscount,
  PricingError,
  priceCart,
  validateCoupon,
  type AppliedCoupon,
  type CartLine,
  type PriceInput,
} from "@/server/domain";

import { line, mulberry32 } from "./fixtures";

function input(lines: CartLine[], over: Partial<PriceInput> = {}): PriceInput {
  return {
    lines,
    coupon: null,
    shipping: { flatFeePaise: 6_000, freeThresholdPaise: 50_000 },
    zone: null,
    paymentMethod: "razorpay",
    cod: { feePaise: 4_000 },
    shippingTaxRule: { kind: "dominant_line_rate" },
    sellerStateCode: "27",
    buyerStateCode: null,
    ...over,
  };
}

function applied(over: Partial<AppliedCoupon> = {}): AppliedCoupon {
  return {
    couponId: "c1",
    code: "SAVE10",
    kind: "percent",
    value: 1000,
    maxDiscountPaise: null,
    minSubtotalPaise: null,
    eligibleLineIds: [],
    discountPaise: 0,
    ...over,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("priceCart: basics", () => {
  it("prices lines without a coupon", () => {
    const a = line({ lineId: "a", unitPricePaise: 11_800, mrpPaise: 14_900, qty: 2 });
    const r = priceCart(input([a]));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({
      lineId: "a",
      lineSubtotalPaise: 23_600,
      discountAllocPaise: 0,
      lineTotalPaise: 23_600,
      taxablePaise: 20_000,
      taxPaise: 3_600,
    });
    expect(r.subtotalPaise).toBe(23_600);
    expect(r.discountPaise).toBe(0);
    expect(r.shippingPaise).toBe(6_000); // below threshold
    expect(r.codFeePaise).toBe(0);
    expect(r.totalPaise).toBe(29_600);
    // lines 3600 + shipping 6000 @18% => 6000 - round(6000*10000/11800)=5085 -> 915
    expect(r.shippingTaxPaise).toBe(915);
    expect(r.taxIncludedPaise).toBe(3_600 + 915);
    expect(r.gst).toBeNull();
    expect(r.appliedCouponCode).toBeNull();
    expect(r.savingsVsMrpPaise).toBe((14_900 - 11_800) * 2);
  });

  it("does not mutate the input lines", () => {
    const lines = [line({ qty: 2 })];
    const snapshot = JSON.stringify(lines);
    priceCart(input(lines));
    expect(JSON.stringify(lines)).toBe(snapshot);
  });

  it("is deterministic", () => {
    const lines = [
      line({ qty: 3, unitPricePaise: 3333, mrpPaise: 4000 }),
      line({ gstRateBp: 500 }),
    ];
    const c = applied({ eligibleLineIds: lines.map((l) => l.lineId) });
    expect(priceCart(input(lines, { coupon: c }))).toEqual(priceCart(input(lines, { coupon: c })));
  });

  it("empty cart is all zeros with no shipping", () => {
    const r = priceCart(
      input([], { paymentMethod: "cod", buyerStateCode: "27", coupon: applied() }),
    );
    expect(r).toMatchObject({
      lines: [],
      subtotalPaise: 0,
      discountPaise: 0,
      shippingPaise: 0,
      shippingDiscountPaise: 0,
      codFeePaise: 0,
      totalPaise: 0,
      taxIncludedPaise: 0,
      freeShippingRemainingPaise: null,
      savingsVsMrpPaise: 0,
      appliedCouponCode: null,
      messages: [],
    });
    expect(r.gst).toEqual({ cgst: 0, sgst: 0, igst: 0 });
    expect(priceCart(input([])).gst).toBeNull();
  });

  it("shows savings vs MRP only from price < MRP (none when equal)", () => {
    expect(
      priceCart(input([line({ unitPricePaise: 5000, mrpPaise: 5000 })])).savingsVsMrpPaise,
    ).toBe(0);
  });
});

describe("priceCart: coupons", () => {
  it("percent coupon over mixed eligibility; allocation sums exactly with remainder to the largest eligible line", () => {
    const a = line({ lineId: "a", unitPricePaise: 3_333, mrpPaise: 3_333 }); // eligible
    const b = line({ lineId: "b", unitPricePaise: 5_001, mrpPaise: 5_001 }); // eligible, largest
    const c = line({ lineId: "c", unitPricePaise: 9_999, mrpPaise: 9_999 }); // NOT eligible
    const coupon = applied({ value: 1000, eligibleLineIds: ["a", "b"] });
    const r = priceCart(input([a, b, c], { coupon }));
    // eligible subtotal 8334 -> 10% = 833 ; floors: 833*3333/8334=333.14->333 ; 833*5001/8334=499.86->499 ; rem=1 -> b
    expect(r.discountPaise).toBe(833);
    const by = Object.fromEntries(r.lines.map((l) => [l.lineId, l]));
    expect(by.a?.discountAllocPaise).toBe(333);
    expect(by.b?.discountAllocPaise).toBe(500);
    expect(by.c?.discountAllocPaise).toBe(0);
    expect(sum(r.lines.map((l) => l.discountAllocPaise))).toBe(r.discountPaise);
    expect(r.totalPaise).toBe(r.subtotalPaise - 833 + r.shippingPaise);
    expect(r.appliedCouponCode).toBe("SAVE10");
  });

  it("remainder goes to the first of equally-large lines", () => {
    const lines = [
      line({ lineId: "a", unitPricePaise: 1_000, mrpPaise: 1_000 }),
      line({ lineId: "b", unitPricePaise: 1_000, mrpPaise: 1_000 }),
      line({ lineId: "c", unitPricePaise: 1_000, mrpPaise: 1_000 }),
    ];
    // fixed 100 across 3 equal lines: 33,33,33 rem 1 -> a
    const r = priceCart(
      input(lines, {
        coupon: applied({ kind: "fixed", value: 100, eligibleLineIds: ["a", "b", "c"] }),
      }),
    );
    expect(r.lines.map((l) => l.discountAllocPaise)).toEqual([34, 33, 33]);
  });

  it("spills the remainder when the largest line has no room", () => {
    const lines = [
      line({ lineId: "a", unitPricePaise: 3, mrpPaise: 3 }),
      line({ lineId: "b", unitPricePaise: 3, mrpPaise: 3 }),
      line({ lineId: "c", unitPricePaise: 3, mrpPaise: 3 }),
    ];
    const r = priceCart(
      input(lines, {
        coupon: applied({ kind: "fixed", value: 8, eligibleLineIds: ["a", "b", "c"] }),
      }),
    );
    expect(r.discountPaise).toBe(8);
    expect(r.lines.map((l) => l.discountAllocPaise)).toEqual([3, 3, 2]);
    expect(r.lines.every((l) => l.lineTotalPaise >= 0)).toBe(true);
  });

  it("fixed coupon larger than the eligible subtotal is capped", () => {
    const a = line({ lineId: "a", unitPricePaise: 4_000, mrpPaise: 4_000 });
    const b = line({ lineId: "b", unitPricePaise: 9_000, mrpPaise: 9_000 });
    const r = priceCart(
      input([a, b], { coupon: applied({ kind: "fixed", value: 100_000, eligibleLineIds: ["a"] }) }),
    );
    expect(r.discountPaise).toBe(4_000);
    expect(r.lines[0]?.lineTotalPaise).toBe(0);
    expect(r.lines[0]?.taxPaise).toBe(0);
    expect(r.lines[1]?.discountAllocPaise).toBe(0);
    expect(r.totalPaise).toBe(9_000 + r.shippingPaise);
  });

  it("maxDiscount caps a percent coupon", () => {
    const a = line({ lineId: "a", unitPricePaise: 100_000, mrpPaise: 100_000 });
    const r = priceCart(
      input([a], {
        coupon: applied({ value: 5000, maxDiscountPaise: 7_500, eligibleLineIds: ["a"] }),
      }),
    );
    expect(r.discountPaise).toBe(7_500);
  });

  it("100% coupon makes the lines free but never negative", () => {
    const a = line({ lineId: "a", unitPricePaise: 1_234, mrpPaise: 1_234 });
    const r = priceCart(input([a], { coupon: applied({ value: 10_000, eligibleLineIds: ["a"] }) }));
    expect(r.discountPaise).toBe(1_234);
    expect(r.lines[0]?.lineTotalPaise).toBe(0);
    expect(r.totalPaise).toBe(r.shippingPaise);
  });

  it("free_shipping coupon zeroes shipping, leaves discount at 0 and exposes shippingDiscountPaise", () => {
    const a = line({ lineId: "a", unitPricePaise: 10_000, mrpPaise: 10_000 });
    const r = priceCart(
      input([a], { coupon: applied({ kind: "free_shipping", value: 0, eligibleLineIds: ["a"] }) }),
    );
    expect(r.discountPaise).toBe(0);
    expect(r.shippingPaise).toBe(0);
    expect(r.shippingDiscountPaise).toBe(6_000);
    expect(r.totalPaise).toBe(10_000);
    expect(r.freeShippingRemainingPaise).toBe(0);
    expect(r.messages.map((m) => m.code)).toEqual(["free_shipping_coupon"]);
    expect(r.appliedCouponCode).toBe("SAVE10");
  });

  it("free_shipping coupon on an already-free cart discounts nothing", () => {
    const a = line({ lineId: "a", unitPricePaise: 60_000, mrpPaise: 60_000 });
    const r = priceCart(
      input([a], { coupon: applied({ kind: "free_shipping", value: 0, eligibleLineIds: ["a"] }) }),
    );
    expect(r.shippingPaise).toBe(0);
    expect(r.shippingDiscountPaise).toBe(0);
  });

  it("free_shipping coupon still leaves the COD fee", () => {
    const a = line({ lineId: "a", unitPricePaise: 10_000, mrpPaise: 10_000 });
    const r = priceCart(
      input([a], {
        paymentMethod: "cod",
        coupon: applied({ kind: "free_shipping", value: 0, eligibleLineIds: ["a"] }),
      }),
    );
    expect(r.totalPaise).toBe(10_000 + 4_000);
  });

  it("drops a coupon whose minimum is no longer met (whole-cart subtotal) and says why", () => {
    const a = line({ lineId: "a", unitPricePaise: 10_000, mrpPaise: 10_000 });
    const r = priceCart(
      input([a], { coupon: applied({ minSubtotalPaise: 35_000, eligibleLineIds: ["a"] }) }),
    );
    expect(r.discountPaise).toBe(0);
    expect(r.appliedCouponCode).toBeNull();
    expect(r.messages).toContainEqual({
      code: "coupon_min_subtotal_unmet",
      text: "Add ₹250 more to use SAVE10",
    });
  });

  it("ignores a coupon whose eligible lines are gone from the cart", () => {
    const a = line({ lineId: "a" });
    const r = priceCart(input([a], { coupon: applied({ eligibleLineIds: ["zzz"] }) }));
    expect(r.discountPaise).toBe(0);
    expect(r.appliedCouponCode).toBeNull();
    expect(r.messages.map((m) => m.code)).toContain("coupon_no_eligible_items");
  });

  it("works end to end with validateCoupon output", () => {
    const lines = [
      line({
        lineId: "a",
        productId: "pa",
        typeSlug: "charms",
        unitPricePaise: 20_000,
        mrpPaise: 25_000,
      }),
      line({
        lineId: "b",
        productId: "pb",
        typeSlug: "hippers",
        unitPricePaise: 30_000,
        mrpPaise: 30_000,
      }),
    ];
    const v = validateCoupon(
      {
        id: "c1",
        code: "charm20",
        kind: "percent",
        value: 2000,
        startsAt: null,
        endsAt: null,
        minSubtotalPaise: null,
        maxDiscountPaise: null,
        usageLimit: null,
        perCustomerLimit: null,
        scope: { types: ["charms"] },
        active: true,
      },
      {
        now: new Date("2026-11-10T00:00:00Z"),
        lines,
        totalRedemptions: 0,
        redemptionsByThisEmail: 0,
      },
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const r = priceCart(input(lines, { coupon: v.applied }));
    expect(r.discountPaise).toBe(v.applied.discountPaise);
    expect(r.discountPaise).toBe(4_000);
    expect(r.lines[1]?.discountAllocPaise).toBe(0);
  });
});

describe("priceCart: shipping", () => {
  const cart = (unit: number) => [line({ lineId: "a", unitPricePaise: unit, mrpPaise: unit })];

  it("charges the flat fee below the threshold and is free exactly at it", () => {
    const below = priceCart(input(cart(49_999)));
    expect(below.shippingPaise).toBe(6_000);
    expect(below.freeShippingRemainingPaise).toBe(1);
    expect(below.messages).toEqual([
      { code: "free_shipping_progress", text: "Add ₹0.01 more for free shipping" },
    ]);

    const at = priceCart(input(cart(50_000)));
    expect(at.shippingPaise).toBe(0);
    expect(at.freeShippingRemainingPaise).toBe(0);
    expect(at.messages.map((m) => m.code)).toEqual(["free_shipping_unlocked"]);

    expect(priceCart(input(cart(50_001))).shippingPaise).toBe(0);
  });

  it("measures the threshold after discount", () => {
    // subtotal 55_000, 10% off -> 49_500 < 50_000 -> pay shipping
    const r = priceCart(input(cart(55_000), { coupon: applied({ eligibleLineIds: ["a"] }) }));
    expect(r.discountPaise).toBe(5_500);
    expect(r.shippingPaise).toBe(6_000);
    expect(r.freeShippingRemainingPaise).toBe(500);
    // 60_000 - 10% = 54_000 >= threshold
    const r2 = priceCart(input(cart(60_000), { coupon: applied({ eligibleLineIds: ["a"] }) }));
    expect(r2.shippingPaise).toBe(0);
  });

  it("never offers free shipping when threshold is null", () => {
    const r = priceCart(
      input(cart(10_000_000), { shipping: { flatFeePaise: 6_000, freeThresholdPaise: null } }),
    );
    expect(r.shippingPaise).toBe(6_000);
    expect(r.freeShippingRemainingPaise).toBeNull();
    expect(r.messages).toEqual([]);
  });

  it("uses zone overrides, falling back to the flat fee", () => {
    const shipping = {
      flatFeePaise: 6_000,
      freeThresholdPaise: 50_000,
      zoneFeeOverridesPaise: { north_east: 12_000, metro_region: 0 },
    };
    expect(priceCart(input(cart(10_000), { shipping, zone: "north_east" })).shippingPaise).toBe(
      12_000,
    );
    expect(priceCart(input(cart(10_000), { shipping, zone: "metro_region" })).shippingPaise).toBe(
      0,
    );
    expect(priceCart(input(cart(10_000), { shipping, zone: "islands" })).shippingPaise).toBe(6_000);
    expect(priceCart(input(cart(10_000), { shipping, zone: null })).shippingPaise).toBe(6_000);
    // free threshold beats a zone override
    expect(priceCart(input(cart(60_000), { shipping, zone: "north_east" })).shippingPaise).toBe(0);
  });

  it("emits no progress message when the fee is zero", () => {
    const r = priceCart(
      input(cart(10_000), { shipping: { flatFeePaise: 0, freeThresholdPaise: 50_000 } }),
    );
    expect(r.messages).toEqual([]);
  });
});

describe("priceCart: COD fee", () => {
  const cart = [line({ lineId: "a", unitPricePaise: 10_000, mrpPaise: 10_000 })];

  it("applies only for cod", () => {
    expect(priceCart(input(cart, { paymentMethod: "cod" })).codFeePaise).toBe(4_000);
    expect(priceCart(input(cart, { paymentMethod: "razorpay" })).codFeePaise).toBe(0);
    expect(priceCart(input(cart, { paymentMethod: null })).codFeePaise).toBe(0);
  });

  it("is in the total and taxed at the shipping tax rate", () => {
    const r = priceCart(input(cart, { paymentMethod: "cod" }));
    expect(r.totalPaise).toBe(10_000 + 6_000 + 4_000);
    expect(r.codFeeTaxPaise).toBe(610); // 4000 - round(4000*10000/11800)=3390
    expect(r.taxIncludedPaise).toBe(1_525 + 915 + 610);
  });
});

describe("priceCart: GST", () => {
  const lines = [
    line({ lineId: "a", unitPricePaise: 11_800, mrpPaise: 11_800, gstRateBp: 1800 }),
    line({ lineId: "b", unitPricePaise: 10_500, mrpPaise: 10_500, gstRateBp: 500 }),
  ];

  it("splits CGST/SGST when buyer and seller states match", () => {
    const r = priceCart(
      input(lines, {
        buyerStateCode: "27",
        shipping: { flatFeePaise: 0, freeThresholdPaise: null },
      }),
    );
    expect(r.taxIncludedPaise).toBe(1_800 + 500);
    expect(r.gst).toEqual({ cgst: 1_150, sgst: 1_150, igst: 0 });
  });

  it("uses IGST for another state", () => {
    const r = priceCart(
      input(lines, {
        buyerStateCode: "29",
        shipping: { flatFeePaise: 0, freeThresholdPaise: null },
      }),
    );
    expect(r.gst).toEqual({ cgst: 0, sgst: 0, igst: 2_300 });
  });

  it("gst components always add up to taxIncluded (odd paise)", () => {
    const odd = [
      line({ lineId: "a", unitPricePaise: 101, mrpPaise: 101 }),
      line({ lineId: "b", unitPricePaise: 103, mrpPaise: 103 }),
    ];
    const r = priceCart(input(odd, { buyerStateCode: "27", paymentMethod: "cod" }));
    expect(r.gst).not.toBeNull();
    expect((r.gst?.cgst ?? 0) + (r.gst?.sgst ?? 0) + (r.gst?.igst ?? 0)).toBe(r.taxIncludedPaise);
  });

  it("is null while the buyer state is unknown", () => {
    expect(priceCart(input(lines)).gst).toBeNull();
  });

  it("rejects a malformed state code only when a split is needed", () => {
    expect(() => priceCart(input(lines, { buyerStateCode: "MH" }))).toThrow();
    expect(() =>
      priceCart(input(lines, { buyerStateCode: null, sellerStateCode: "bad" })),
    ).not.toThrow();
  });

  it("dominant line rate drives shipping tax; larger total wins", () => {
    const l = [
      line({ lineId: "a", unitPricePaise: 30_000, mrpPaise: 30_000, gstRateBp: 500 }),
      line({ lineId: "b", unitPricePaise: 10_000, mrpPaise: 10_000, gstRateBp: 1800 }),
      line({ lineId: "c", unitPricePaise: 5_000, mrpPaise: 5_000, gstRateBp: 1800 }),
    ];
    // 5% sum 30_000 vs 18% sum 15_000
    expect(priceCart(input(l)).shippingTaxRateBp).toBe(500);
    expect(priceCart(input(l)).shippingTaxPaise).toBe(6_000 - 5_714); // round(6000*10000/10500)=5714
  });

  it("dominant rate is measured after discount allocation", () => {
    const l = [
      line({ lineId: "a", unitPricePaise: 30_000, mrpPaise: 30_000, gstRateBp: 500 }),
      line({ lineId: "b", unitPricePaise: 20_000, mrpPaise: 20_000, gstRateBp: 1800 }),
    ];
    const r = priceCart(
      input(l, { coupon: applied({ kind: "fixed", value: 25_000, eligibleLineIds: ["a"] }) }),
    );
    // a: 30_000-25_000 = 5_000 (5%) ; b: 20_000 (18%) -> 18% dominates
    expect(r.shippingTaxRateBp).toBe(1800);
  });

  it("ties go to the higher rate", () => {
    const l = [
      line({ lineId: "a", unitPricePaise: 10_000, mrpPaise: 10_000, gstRateBp: 500 }),
      line({ lineId: "b", unitPricePaise: 10_000, mrpPaise: 10_000, gstRateBp: 1800 }),
      line({ lineId: "c", unitPricePaise: 10_000, mrpPaise: 10_000, gstRateBp: 300 }),
    ];
    expect(priceCart(input(l)).shippingTaxRateBp).toBe(1800);
    expect(priceCart(input([...l].reverse())).shippingTaxRateBp).toBe(1800);
  });

  it("all-zero line totals still resolve deterministically to the highest rate", () => {
    const l = [
      line({ lineId: "a", unitPricePaise: 0, mrpPaise: 0, gstRateBp: 500 }),
      line({ lineId: "b", unitPricePaise: 0, mrpPaise: 0, gstRateBp: 1200 }),
    ];
    expect(priceCart(input(l)).shippingTaxRateBp).toBe(1200);
  });

  it("supports a fixed shipping tax rate (including 0%)", () => {
    const l = [line({ lineId: "a", unitPricePaise: 10_000, mrpPaise: 10_000, gstRateBp: 500 })];
    const fixed = priceCart(input(l, { shippingTaxRule: { kind: "fixed", rateBp: 1800 } }));
    expect(fixed.shippingTaxRateBp).toBe(1800);
    expect(fixed.shippingTaxPaise).toBe(915);
    const zero = priceCart(input(l, { shippingTaxRule: { kind: "fixed", rateBp: 0 } }));
    expect(zero.shippingTaxPaise).toBe(0);
  });
});

describe("allocateDiscount", () => {
  it("sums exactly and never exceeds an item", () => {
    const items = [
      { id: "a", subtotalPaise: 7 },
      { id: "b", subtotalPaise: 13 },
      { id: "c", subtotalPaise: 1 },
    ];
    for (let d = 0; d <= 21; d++) {
      const m = allocateDiscount(d, items);
      expect(sum([...m.values()])).toBe(d);
      for (const i of items) {
        expect(m.get(i.id)).toBeLessThanOrEqual(i.subtotalPaise);
      }
    }
  });

  it("handles empty lists and zero totals", () => {
    expect(allocateDiscount(0, []).size).toBe(0);
    expect(allocateDiscount(0, [{ id: "a", subtotalPaise: 0 }]).get("a")).toBe(0);
  });

  it("rejects discounts outside 0..total", () => {
    expect(() => allocateDiscount(11, [{ id: "a", subtotalPaise: 10 }])).toThrow(PricingError);
    expect(() => allocateDiscount(-1, [{ id: "a", subtotalPaise: 10 }])).toThrow(PricingError);
  });
});

describe("priceCart: invalid input throws PricingError", () => {
  const ok = () => line({ lineId: "ok" });
  const code = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(PricingError);
      return (e as PricingError).code;
    }
    throw new Error("did not throw");
  };

  it.each([0, -1, 1.5, Number.NaN, Infinity])("qty %s", (qty) => {
    expect(code(() => priceCart(input([line({ qty })])))).toBe("invalid_qty");
  });

  it.each([-1, 1.5, Number.NaN])("unit price %s", (p) => {
    expect(code(() => priceCart(input([line({ unitPricePaise: p, mrpPaise: 100 })])))).toBe(
      "invalid_price",
    );
  });

  it.each([-1, 1.5])("mrp %s", (p) => {
    expect(code(() => priceCart(input([line({ unitPricePaise: 0, mrpPaise: p })])))).toBe(
      "invalid_mrp",
    );
  });

  it("price above MRP", () => {
    expect(code(() => priceCart(input([line({ unitPricePaise: 101, mrpPaise: 100 })])))).toBe(
      "price_exceeds_mrp",
    );
  });

  it.each([-1, 1.5, 10_001])("gst rate %s", (gstRateBp) => {
    expect(code(() => priceCart(input([line({ gstRateBp })])))).toBe("invalid_gst_rate");
  });

  it("duplicate lineId", () => {
    expect(code(() => priceCart(input([line({ lineId: "x" }), line({ lineId: "x" })])))).toBe(
      "duplicate_line",
    );
  });

  it("overflowing line amounts", () => {
    expect(
      code(() =>
        priceCart(input([line({ unitPricePaise: 2 ** 40, mrpPaise: 2 ** 40, qty: 2 ** 20 })])),
      ),
    ).toBe("invalid_price");
  });

  it("bad config", () => {
    const l = [ok()];
    expect(
      code(() => priceCart(input(l, { shipping: { flatFeePaise: -1, freeThresholdPaise: null } }))),
    ).toBe("invalid_config");
    expect(
      code(() =>
        priceCart(input(l, { shipping: { flatFeePaise: 1.5, freeThresholdPaise: null } })),
      ),
    ).toBe("invalid_config");
    expect(
      code(() => priceCart(input(l, { shipping: { flatFeePaise: 0, freeThresholdPaise: -5 } }))),
    ).toBe("invalid_config");
    expect(
      code(() =>
        priceCart(
          input(l, {
            shipping: {
              flatFeePaise: 0,
              freeThresholdPaise: null,
              zoneFeeOverridesPaise: { x: -1 },
            },
          }),
        ),
      ),
    ).toBe("invalid_config");
    expect(code(() => priceCart(input(l, { cod: { feePaise: -1 } })))).toBe("invalid_config");
    expect(
      code(() => priceCart(input(l, { shippingTaxRule: { kind: "fixed", rateBp: 20_000 } }))),
    ).toBe("invalid_config");
    expect(
      code(() => priceCart(input(l, { shippingTaxRule: { kind: "fixed", rateBp: -1 } }))),
    ).toBe("invalid_config");
  });

  it("validates even when the cart would be empty-priced", () => {
    expect(code(() => priceCart(input([], { cod: { feePaise: -1 } })))).toBe("invalid_config");
  });
});

describe("priceCart: randomized invariants (seeded)", () => {
  const rand = mulberry32(20261101);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;

  it("holds for 500 random carts", () => {
    const rates = [0, 300, 500, 1200, 1800];
    const kinds = ["percent", "fixed", "free_shipping"] as const;
    const methods = ["razorpay", "cod", null] as const;
    const zones = [null, "metro_region", "north_east", "islands"] as const;

    for (let n = 0; n < 500; n++) {
      const count = int(0, 6);
      const lines: CartLine[] = Array.from({ length: count }, (_, i) => {
        const unit = int(0, 250_000);
        return line({
          lineId: `r${n}-${i}`,
          unitPricePaise: unit,
          mrpPaise: unit + int(0, 50_000),
          qty: int(1, 5),
          gstRateBp: pick(rates),
        });
      });
      const eligible = lines.filter(() => rand() < 0.6).map((l) => l.lineId);
      const kind = pick(kinds);
      const coupon =
        rand() < 0.7
          ? applied({
              kind,
              value: kind === "percent" ? int(1, 10_000) : kind === "fixed" ? int(1, 500_000) : 0,
              maxDiscountPaise: rand() < 0.3 ? int(0, 100_000) : null,
              minSubtotalPaise: rand() < 0.2 ? int(0, 300_000) : null,
              eligibleLineIds: eligible,
            })
          : null;
      const buyer = pick(["27", "29", null] as const);
      const r = priceCart(
        input(lines, {
          coupon,
          paymentMethod: pick(methods),
          zone: pick(zones),
          buyerStateCode: buyer,
          shipping: {
            flatFeePaise: int(0, 20_000),
            freeThresholdPaise: rand() < 0.7 ? int(0, 400_000) : null,
            zoneFeeOverridesPaise: { north_east: int(0, 30_000) },
          },
          cod: { feePaise: int(0, 10_000) },
          shippingTaxRule:
            rand() < 0.5 ? { kind: "dominant_line_rate" } : { kind: "fixed", rateBp: pick(rates) },
        }),
      );

      expect(r.totalPaise).toBe(
        r.subtotalPaise - r.discountPaise + r.shippingPaise + r.codFeePaise,
      );
      expect(sum(r.lines.map((l) => l.discountAllocPaise))).toBe(r.discountPaise);
      expect(sum(r.lines.map((l) => l.lineSubtotalPaise))).toBe(r.subtotalPaise);
      expect(r.discountPaise).toBeLessThanOrEqual(r.subtotalPaise);
      const eligibleIds = new Set(coupon?.eligibleLineIds ?? []);
      for (const l of r.lines) {
        expect(l.lineTotalPaise).toBe(l.lineSubtotalPaise - l.discountAllocPaise);
        expect(l.discountAllocPaise).toBeGreaterThanOrEqual(0);
        expect(l.discountAllocPaise).toBeLessThanOrEqual(l.lineSubtotalPaise);
        expect(l.lineTotalPaise).toBeGreaterThanOrEqual(0);
        expect(l.taxablePaise + l.taxPaise).toBe(l.lineTotalPaise);
        expect(l.taxPaise).toBeGreaterThanOrEqual(0);
        if (!eligibleIds.has(l.lineId)) expect(l.discountAllocPaise).toBe(0);
      }
      for (const v of [
        r.subtotalPaise,
        r.discountPaise,
        r.shippingPaise,
        r.shippingDiscountPaise,
        r.codFeePaise,
        r.totalPaise,
        r.taxIncludedPaise,
        r.savingsVsMrpPaise,
      ]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      expect(r.taxIncludedPaise).toBe(
        sum(r.lines.map((l) => l.taxPaise)) + r.shippingTaxPaise + r.codFeeTaxPaise,
      );
      expect(r.taxIncludedPaise).toBeLessThanOrEqual(r.totalPaise);
      if (r.gst === null) {
        expect(buyer).toBeNull();
      } else {
        expect(r.gst.cgst + r.gst.sgst + r.gst.igst).toBe(r.taxIncludedPaise);
      }
      if (count === 0) {
        expect(r.totalPaise).toBe(0);
      }
      if (r.freeShippingRemainingPaise !== null) {
        expect(r.freeShippingRemainingPaise).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
