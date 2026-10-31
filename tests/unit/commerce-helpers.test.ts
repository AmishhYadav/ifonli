import { describe, expect, it } from "vitest";

import { checkServiceability, estimateDelivery, evaluateCod } from "@/server/services/commerce/pincode";
import type { CommerceSettings } from "@/server/services/commerce/settings";
import { checkoutFingerprint, composeIdempotencyKey } from "@/server/services/commerce/idempotency";

const settings = (over: Partial<CommerceSettings["cod"]> = {}): CommerceSettings => ({
  shipping: {
    flatFeePaise: 5000,
    freeThresholdPaise: 50000,
    zoneFeeOverridesPaise: {},
    serviceabilityMode: "all_india",
    processingDays: 1,
    deliveryEstimatesByZone: { metro_region: { minDays: 2, maxDays: 4 } },
  },
  cod: { enabled: true, feePaise: 4000, maxOrderValuePaise: 100000, excludedPincodes: [], ...over },
  tax: {
    defaultGstRateBp: 1800,
    shippingTaxRule: { kind: "dominant_line_rate" },
    sellerStateCode: "27",
  },
  inventory: { maxQtyPerLine: 10, reservationTtlMinutes: 15, defaultLowStockThreshold: 5 },
});

const info = (over: Partial<Parameters<typeof checkServiceability>[1] & object> = {}) => ({
  pincode: "400001",
  district: "Mumbai",
  stateCode: "27",
  stateName: "Maharashtra",
  zone: "metro_region" as string | null,
  serviceable: true,
  codAllowed: true,
  ...over,
});

describe("checkServiceability", () => {
  it("accepts serviceable pincodes", () => {
    expect(checkServiceability("400001", info())).toEqual({ serviceable: true });
  });
  it("explains each failure", () => {
    expect(checkServiceability("abc", null)).toMatchObject({ code: "invalid_pincode" });
    expect(checkServiceability("040001", null)).toMatchObject({ code: "invalid_pincode" });
    expect(checkServiceability("999999", null)).toMatchObject({ code: "unknown_pincode" });
    expect(checkServiceability("400001", info({ serviceable: false }))).toEqual({
      serviceable: false,
      code: "not_serviceable",
      message: "Sorry, we can't deliver to 400001 yet.",
    });
  });
});

describe("evaluateCod", () => {
  it("compares the total INCLUDING the COD fee: eligible at exactly the maximum, ineligible one paisa above", () => {
    // max 1,00,000 and a fee of 4,000: the goods + shipping may be at most 96,000.
    expect(evaluateCod(settings(), info(), 96000)).toEqual({ eligible: true });
    expect(evaluateCod(settings(), info(), 96001)).toMatchObject({ eligible: false, code: "over_max_value" });
    expect(evaluateCod(settings({ feePaise: 0 }), info(), 100000)).toEqual({ eligible: true });
  });
  it("respects the setting, the pincode flag, the excluded list and an unknown pincode", () => {
    expect(evaluateCod(settings({ enabled: false }), info(), 100)).toMatchObject({ code: "cod_disabled" });
    expect(evaluateCod(settings(), info({ codAllowed: false }), 100)).toMatchObject({
      code: "pincode_not_allowed",
    });
    expect(evaluateCod(settings({ excludedPincodes: ["400001"] }), info(), 100)).toMatchObject({
      code: "pincode_not_allowed",
    });
    expect(evaluateCod(settings(), null, 100)).toMatchObject({ code: "pincode_not_allowed" });
  });
  it("a maximum of 0 means no COD", () => {
    expect(evaluateCod(settings({ maxOrderValuePaise: 0 }), info(), 100)).toMatchObject({
      code: "over_max_value",
    });
  });
});

describe("estimateDelivery", () => {
  const monday = new Date("2026-11-02T04:30:00Z");
  it("uses the pincode zone range plus processing days", () => {
    expect(estimateDelivery(settings(), info(), monday)).toEqual({
      fromDate: "2026-11-05",
      toDate: "2026-11-07",
    });
  });
  it("is null without a zone or a configured range", () => {
    expect(estimateDelivery(settings(), info({ zone: null }), monday)).toBeNull();
    expect(estimateDelivery(settings(), info({ zone: "islands" }), monday)).toBeNull();
    expect(estimateDelivery(settings(), null, monday)).toBeNull();
  });
});

describe("idempotency key", () => {
  const base = {
    paymentMethod: "razorpay",
    email: "a@example.com",
    phone: "+919876543210",
    address: { name: "A", line1: "1 Road", city: "Mumbai", state: "MH", pincode: "400001" },
  };
  it("is stable for the same inputs, case-insensitive for email", () => {
    expect(checkoutFingerprint(base)).toBe(checkoutFingerprint({ ...base, email: "A@Example.com " }));
    expect(checkoutFingerprint(base)).toMatch(/^[0-9a-f]{16}$/);
  });
  it("changes when the method, contact or address change", () => {
    const fp = checkoutFingerprint(base);
    expect(checkoutFingerprint({ ...base, paymentMethod: "cod" })).not.toBe(fp);
    expect(checkoutFingerprint({ ...base, phone: "+919876543211" })).not.toBe(fp);
    expect(checkoutFingerprint({ ...base, address: { ...base.address, line1: "2 Road" } })).not.toBe(fp);
    expect(checkoutFingerprint({ ...base, address: { ...base.address, line2: "Flat 4" } })).not.toBe(fp);
  });
  it("composes cart, version, fingerprint and client key", () => {
    expect(
      composeIdempotencyKey({ cartId: "c1", cartVersion: 7, fingerprint: "abc", clientKey: "k" }),
    ).toBe("c1:v7:abc:k");
  });
});
