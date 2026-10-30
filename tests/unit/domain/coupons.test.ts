import { describe, expect, it } from "vitest";

import {
  couponDiscountPaise,
  isLineEligible,
  normalizeCode,
  validateCoupon,
  type CouponContext,
  type CouponRecord,
} from "@/server/domain";

import { line } from "./fixtures";

const NOW = new Date("2026-11-10T06:30:00Z");

function coupon(over: Partial<CouponRecord> = {}): CouponRecord {
  return {
    id: "c1",
    code: "SAVE10",
    kind: "percent",
    value: 1000,
    startsAt: null,
    endsAt: null,
    minSubtotalPaise: null,
    maxDiscountPaise: null,
    usageLimit: null,
    perCustomerLimit: null,
    scope: {},
    active: true,
    ...over,
  };
}

function ctx(over: Partial<CouponContext> = {}): CouponContext {
  return {
    now: NOW,
    lines: [line({ lineId: "a", unitPricePaise: 10_000, mrpPaise: 10_000, qty: 2 })],
    totalRedemptions: 0,
    redemptionsByThisEmail: 0,
    alreadyAppliedCode: null,
    ...over,
  };
}

function reject(c: CouponRecord, x: CouponContext) {
  const r = validateCoupon(c, x);
  if (r.ok) throw new Error("expected rejection");
  return r;
}

describe("normalizeCode", () => {
  it("trims and upper-cases", () => {
    expect(normalizeCode("  save10 ")).toBe("SAVE10");
    expect(normalizeCode("SaVe10")).toBe("SAVE10");
    expect(normalizeCode("")).toBe("");
  });
});

describe("validateCoupon: accepted", () => {
  it("applies a percent coupon and previews the discount", () => {
    const r = validateCoupon(coupon({ code: " save10 " }), ctx());
    expect(r).toEqual({
      ok: true,
      applied: {
        couponId: "c1",
        code: "SAVE10",
        kind: "percent",
        value: 1000,
        maxDiscountPaise: null,
        minSubtotalPaise: null,
        eligibleLineIds: ["a"],
        discountPaise: 2000,
      },
    });
  });

  it("previews fixed (capped at eligible subtotal) and free_shipping (0)", () => {
    const fixed = validateCoupon(coupon({ kind: "fixed", value: 50_000 }), ctx());
    expect(fixed.ok && fixed.applied.discountPaise).toBe(20_000);
    const free = validateCoupon(coupon({ kind: "free_shipping", value: 0 }), ctx());
    expect(free.ok && free.applied.discountPaise).toBe(0);
  });

  it("allows re-applying the same code (any case) without stacking error", () => {
    expect(validateCoupon(coupon(), ctx({ alreadyAppliedCode: "save10" })).ok).toBe(true);
  });
});

describe("validateCoupon: rejections in order", () => {
  it("inactive", () => {
    const r = reject(coupon({ active: false }), ctx());
    expect(r.code).toBe("inactive");
    expect(r.message).toBe("SAVE10 isn't active right now.");
  });

  it("malformed records are treated as inactive", () => {
    expect(reject(coupon({ kind: "percent", value: 0 }), ctx()).code).toBe("inactive");
    expect(reject(coupon({ kind: "percent", value: 10_001 }), ctx()).code).toBe("inactive");
    expect(reject(coupon({ kind: "percent", value: 10.5 }), ctx()).code).toBe("inactive");
    expect(reject(coupon({ kind: "fixed", value: 0 }), ctx()).code).toBe("inactive");
    expect(reject(coupon({ kind: "fixed", value: -5 }), ctx()).code).toBe("inactive");
  });

  it("not_started, with the date in IST", () => {
    // 2026-10-31T19:00Z is 1 Nov 00:30 IST
    const r = reject(
      coupon({ startsAt: new Date("2026-10-31T19:00:00Z") }),
      ctx({ now: new Date("2026-10-30T00:00:00Z") }),
    );
    expect(r.code).toBe("not_started");
    expect(r.message).toBe("This code starts on 1 Nov 2026");
  });

  it("starts exactly at startsAt", () => {
    const c = coupon({ startsAt: NOW });
    expect(validateCoupon(c, ctx()).ok).toBe(true);
    expect(reject(c, ctx({ now: new Date(NOW.getTime() - 1) })).code).toBe("not_started");
  });

  it("expired, with the date in IST", () => {
    const r = reject(coupon({ endsAt: new Date("2026-11-09T18:30:00Z") }), ctx());
    expect(r.code).toBe("expired");
    expect(r.message).toBe("This code expired on 10 Nov 2026");
  });

  it("is valid through endsAt and expired after it", () => {
    const c = coupon({ endsAt: NOW });
    expect(validateCoupon(c, ctx()).ok).toBe(true);
    expect(reject(c, ctx({ now: new Date(NOW.getTime() + 1) })).code).toBe("expired");
  });

  it("usage_exhausted", () => {
    const c = coupon({ usageLimit: 100 });
    expect(validateCoupon(c, ctx({ totalRedemptions: 99 })).ok).toBe(true);
    const r = reject(c, ctx({ totalRedemptions: 100 }));
    expect(r.code).toBe("usage_exhausted");
    expect(r.message).toBe("This code has been fully claimed.");
  });

  it("per_customer_exhausted", () => {
    const c = coupon({ perCustomerLimit: 1 });
    expect(validateCoupon(c, ctx({ redemptionsByThisEmail: 0 })).ok).toBe(true);
    const r = reject(c, ctx({ redemptionsByThisEmail: 1 }));
    expect(r.code).toBe("per_customer_exhausted");
    expect(r.message).toBe("This code has already been used with your email.");
  });

  it("no_eligible_items", () => {
    const r = reject(coupon({ scope: { types: ["hippers"] } }), ctx());
    expect(r.code).toBe("no_eligible_items");
    expect(r.message).toBe("This code doesn't apply to the items in your cart.");
    expect(reject(coupon(), ctx({ lines: [] })).code).toBe("no_eligible_items");
  });

  it("min_subtotal uses the whole cart subtotal and formats rupees", () => {
    // cart = 200 rupees (20_000 paise); need 350 -> add 150
    const r = reject(coupon({ minSubtotalPaise: 35_000 }), ctx());
    expect(r.code).toBe("min_subtotal");
    expect(r.message).toBe("Add ₹150 more to use SAVE10");
    // exactly at the minimum is accepted
    expect(validateCoupon(coupon({ minSubtotalPaise: 20_000 }), ctx()).ok).toBe(true);
    // paise show decimals
    expect(reject(coupon({ minSubtotalPaise: 20_050 }), ctx()).message).toBe(
      "Add ₹0.50 more to use SAVE10",
    );
  });

  it("min_subtotal compares the whole cart, not just eligible lines", () => {
    const lines = [
      line({ lineId: "a", typeSlug: "charms", unitPricePaise: 10_000, mrpPaise: 10_000 }),
      line({ lineId: "b", typeSlug: "hippers", unitPricePaise: 30_000, mrpPaise: 30_000 }),
    ];
    const c = coupon({ scope: { types: ["charms"] }, minSubtotalPaise: 35_000 });
    const r = validateCoupon(c, ctx({ lines }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.applied.eligibleLineIds).toEqual(["a"]);
      expect(r.applied.discountPaise).toBe(1000); // 10% of the eligible 10_000 only
    }
  });

  it("stacking", () => {
    const r = reject(coupon(), ctx({ alreadyAppliedCode: "welcome5" }));
    expect(r.code).toBe("stacking");
    expect(r.message).toBe("Only one code can be used per order. Remove WELCOME5 to use SAVE10.");
  });

  it("reports the first failing check", () => {
    const c = coupon({
      active: true,
      endsAt: new Date("2026-01-01T00:00:00Z"),
      usageLimit: 1,
      perCustomerLimit: 1,
      minSubtotalPaise: 10 ** 9,
      scope: { types: ["nothing"] },
    });
    const x = ctx({ totalRedemptions: 5, redemptionsByThisEmail: 5, alreadyAppliedCode: "OTHER" });
    expect(reject(c, x).code).toBe("expired");
    expect(reject({ ...c, endsAt: null }, x).code).toBe("usage_exhausted");
    expect(reject({ ...c, endsAt: null, usageLimit: null }, x).code).toBe("per_customer_exhausted");
    expect(reject({ ...c, endsAt: null, usageLimit: null, perCustomerLimit: null }, x).code).toBe(
      "no_eligible_items",
    );
    expect(
      reject({ ...c, endsAt: null, usageLimit: null, perCustomerLimit: null, scope: {} }, x).code,
    ).toBe("min_subtotal");
    expect(
      reject(
        {
          ...c,
          endsAt: null,
          usageLimit: null,
          perCustomerLimit: null,
          scope: {},
          minSubtotalPaise: null,
        },
        x,
      ).code,
    ).toBe("stacking");
  });

  it("messages are blame-free and free of urgency / shaming", () => {
    const messages = [
      reject(coupon({ active: false }), ctx()).message,
      reject(coupon({ usageLimit: 1 }), ctx({ totalRedemptions: 1 })).message,
      reject(coupon({ perCustomerLimit: 1 }), ctx({ redemptionsByThisEmail: 1 })).message,
      reject(coupon({ scope: { types: ["x"] } }), ctx()).message,
    ];
    for (const m of messages) {
      expect(m).not.toMatch(/you (failed|forgot|missed)|hurry|last chance|only .* left|!/i);
    }
  });
});

describe("scope matching", () => {
  const l = line({ productId: "p1", typeSlug: "charms", vibeSlugs: ["cute", "gothic"] });

  it("empty scope matches everything", () => {
    expect(isLineEligible({}, l)).toBe(true);
    expect(isLineEligible({ vibes: [], types: [], products: [], excludeProducts: [] }, l)).toBe(
      true,
    );
  });

  it("matches by vibe, type or product (any)", () => {
    expect(isLineEligible({ vibes: ["gothic"] }, l)).toBe(true);
    expect(isLineEligible({ vibes: ["minimal"] }, l)).toBe(false);
    expect(isLineEligible({ types: ["charms"] }, l)).toBe(true);
    expect(isLineEligible({ types: ["hippers"] }, l)).toBe(false);
    expect(isLineEligible({ products: ["p1"] }, l)).toBe(true);
    expect(isLineEligible({ products: ["p2"] }, l)).toBe(false);
    // any-of semantics across dimensions
    expect(isLineEligible({ vibes: ["minimal"], types: ["charms"] }, l)).toBe(true);
    expect(isLineEligible({ vibes: ["minimal"], types: ["hippers"], products: ["p2"] }, l)).toBe(
      false,
    );
  });

  it("a line with no vibes never matches a vibe scope", () => {
    expect(isLineEligible({ vibes: ["cute"] }, line({ vibeSlugs: [] }))).toBe(false);
  });

  it("exclusions beat inclusions and apply to an otherwise-empty scope", () => {
    expect(isLineEligible({ excludeProducts: ["p1"] }, l)).toBe(false);
    expect(isLineEligible({ excludeProducts: ["p2"] }, l)).toBe(true);
    expect(isLineEligible({ types: ["charms"], excludeProducts: ["p1"] }, l)).toBe(false);
  });

  it("validateCoupon lists only eligible line ids", () => {
    const lines = [
      line({ lineId: "a", productId: "pa", vibeSlugs: ["cute"] }),
      line({ lineId: "b", productId: "pb", vibeSlugs: ["gothic"] }),
      line({ lineId: "c", productId: "pc", vibeSlugs: ["cute"] }),
    ];
    const r = validateCoupon(
      coupon({ scope: { vibes: ["cute"], excludeProducts: ["pc"] } }),
      ctx({ lines }),
    );
    expect(r.ok && r.applied.eligibleLineIds).toEqual(["a"]);
  });
});

describe("couponDiscountPaise", () => {
  it("percent floors", () => {
    expect(couponDiscountPaise("percent", 1000, null, 9_999)).toBe(999); // 999.9 -> 999
    expect(couponDiscountPaise("percent", 3333, null, 100)).toBe(33);
    expect(couponDiscountPaise("percent", 10_000, null, 777)).toBe(777);
  });

  it("caps by maxDiscount", () => {
    expect(couponDiscountPaise("percent", 5000, 1000, 10_000)).toBe(1000);
    expect(couponDiscountPaise("percent", 5000, 9000, 10_000)).toBe(5000);
    expect(couponDiscountPaise("fixed", 8000, 3000, 10_000)).toBe(3000);
  });

  it("fixed never exceeds the eligible subtotal", () => {
    expect(couponDiscountPaise("fixed", 8000, null, 5000)).toBe(5000);
    expect(couponDiscountPaise("fixed", 8000, null, 20_000)).toBe(8000);
  });

  it("is zero for free_shipping or empty subtotal", () => {
    expect(couponDiscountPaise("free_shipping", 0, null, 5000)).toBe(0);
    expect(couponDiscountPaise("percent", 1000, null, 0)).toBe(0);
  });
});
