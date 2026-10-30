import { describe, expect, it } from "vitest";

import { codEligibility, deliveryEstimate } from "@/server/domain";

const base = {
  codEnabled: true,
  pincodeCodAllowed: true,
  orderTotalPaise: 50_000,
  codMaxOrderValuePaise: 100_000 as number | null,
  hasExcludedItems: false,
};

describe("codEligibility", () => {
  it("is eligible when every rule passes", () => {
    expect(codEligibility(base)).toEqual({ eligible: true });
  });

  it("allows an order exactly at the max and with no cap", () => {
    expect(codEligibility({ ...base, orderTotalPaise: 100_000 }).eligible).toBe(true);
    expect(
      codEligibility({ ...base, orderTotalPaise: 9_999_999, codMaxOrderValuePaise: null }).eligible,
    ).toBe(true);
  });

  it("rejects one paisa over the max with a formatted reason", () => {
    expect(codEligibility({ ...base, orderTotalPaise: 100_001 })).toEqual({
      eligible: false,
      code: "over_max_value",
      reason: "Cash on delivery is available for orders up to ₹1,000.",
    });
  });

  it("rejects when disabled, pincode blocked, or excluded items", () => {
    expect(codEligibility({ ...base, codEnabled: false })).toMatchObject({
      eligible: false,
      code: "cod_disabled",
    });
    expect(codEligibility({ ...base, pincodeCodAllowed: false })).toMatchObject({
      eligible: false,
      code: "pincode_not_allowed",
    });
    expect(codEligibility({ ...base, hasExcludedItems: true })).toMatchObject({
      eligible: false,
      code: "excluded_items",
    });
  });

  it("reports the first failing rule", () => {
    const all = {
      ...base,
      codEnabled: false,
      pincodeCodAllowed: false,
      hasExcludedItems: true,
      orderTotalPaise: 10 ** 9,
    };
    expect(codEligibility(all)).toMatchObject({ code: "cod_disabled" });
    expect(codEligibility({ ...all, codEnabled: true })).toMatchObject({
      code: "pincode_not_allowed",
    });
    expect(codEligibility({ ...all, codEnabled: true, pincodeCodAllowed: true })).toMatchObject({
      code: "excluded_items",
    });
  });

  it("gives human, non-empty reasons", () => {
    for (const patch of [
      { codEnabled: false },
      { pincodeCodAllowed: false },
      { hasExcludedItems: true },
    ]) {
      const r = codEligibility({ ...base, ...patch });
      expect(r.eligible).toBe(false);
      if (!r.eligible) {
        expect(r.reason.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("deliveryEstimate", () => {
  const range = { minDays: 3, maxDays: 5 };

  it("counts working days from today (Mon 2 Nov 2026 IST)", () => {
    // Mon 2 Nov + 1 processing + 3 = Fri 6 Nov ; +1 +5 = Tue..Sat, Sunday skipped, Mon 9 Nov
    const now = new Date("2026-11-02T05:00:00Z");
    expect(deliveryEstimate({ processingDays: 1, zoneRange: range, now })).toEqual({
      fromDate: "2026-11-06",
      toDate: "2026-11-09",
    });
  });

  it("skips Sundays", () => {
    // Thu 5 Nov + 0 + 3: Fri(1) Sat(2) [Sun skipped] Mon(3) = Mon 9 Nov ; +5: Tue(4) Wed(5) = 11 Nov
    const now = new Date("2026-11-05T05:00:00Z");
    expect(deliveryEstimate({ processingDays: 0, zoneRange: range, now })).toEqual({
      fromDate: "2026-11-09",
      toDate: "2026-11-11",
    });
  });

  it("never lands on a Sunday, even with zero days", () => {
    // Sun 8 Nov
    const now = new Date("2026-11-08T05:00:00Z");
    expect(
      deliveryEstimate({ processingDays: 0, zoneRange: { minDays: 0, maxDays: 0 }, now }),
    ).toEqual({
      fromDate: "2026-11-09",
      toDate: "2026-11-09",
    });
  });

  it("uses the IST date: late evening UTC is already tomorrow in India", () => {
    // 2026-11-05T20:00Z = Fri 6 Nov 01:30 IST ; 0 + 1 day -> Sat 7 Nov
    const now = new Date("2026-11-05T20:00:00Z");
    expect(
      deliveryEstimate({ processingDays: 0, zoneRange: { minDays: 1, maxDays: 2 }, now }),
    ).toEqual({
      fromDate: "2026-11-07",
      toDate: "2026-11-09",
    });
  });

  it("crosses month and year ends", () => {
    const now = new Date("2026-12-30T05:00:00Z"); // Wed
    const r = deliveryEstimate({ processingDays: 1, zoneRange: { minDays: 2, maxDays: 6 }, now });
    // +3: Thu 31, Fri 1 Jan, Sat 2 Jan -> 2027-01-02 ; +7: ... Mon 4,Tue 5,Wed 6,Thu 7 -> 2027-01-07
    expect(r).toEqual({ fromDate: "2027-01-02", toDate: "2027-01-07" });
  });

  it("validates inputs", () => {
    const now = new Date("2026-11-02T05:00:00Z");
    expect(() => deliveryEstimate({ processingDays: -1, zoneRange: range, now })).toThrow(
      RangeError,
    );
    expect(() => deliveryEstimate({ processingDays: 1.5, zoneRange: range, now })).toThrow(
      RangeError,
    );
    expect(() =>
      deliveryEstimate({ processingDays: 1, zoneRange: { minDays: 5, maxDays: 3 }, now }),
    ).toThrow(RangeError);
    expect(() =>
      deliveryEstimate({ processingDays: 1, zoneRange: { minDays: -1, maxDays: 3 }, now }),
    ).toThrow(RangeError);
    expect(() =>
      deliveryEstimate({ processingDays: 1, zoneRange: { minDays: 1, maxDays: 0.5 }, now }),
    ).toThrow(RangeError);
    expect(() =>
      deliveryEstimate({ processingDays: 1, zoneRange: range, now: new Date("nope") }),
    ).toThrow(RangeError);
  });
});
