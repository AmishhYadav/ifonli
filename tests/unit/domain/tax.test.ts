import { describe, expect, it } from "vitest";

import { splitGst, taxIncludedIn, TaxError } from "@/server/domain";

describe("taxIncludedIn", () => {
  it.each([
    // gross, rate, taxable, tax
    [11800, 1800, 10000, 1800],
    [11800, 0, 11800, 0],
    [10500, 500, 10000, 500],
    [10300, 300, 10000, 300],
    [0, 1800, 0, 0],
    [1, 1800, 1, 0], // 0.847 -> 1
    [1, 0, 1, 0],
    [99, 1800, 84, 15], // 83.898 -> 84
    [100, 1800, 85, 15], // 84.745 -> 85
    [100, 500, 95, 5], // 95.238 -> 95
    [100, 300, 97, 3], // 97.087 -> 97
    [12345, 1800, 10462, 1883], // 10461.86 -> 10462
    [129900, 1800, 110085, 19815], // 110084.746 -> 110085
  ])("gross %i @ %i bp -> taxable %i, tax %i", (gross, rate, taxable, tax) => {
    expect(taxIncludedIn(gross, rate)).toEqual({ taxablePaise: taxable, taxPaise: tax });
  });

  it("rounds exact halves up", () => {
    // gross=3, rate=10000 (100%): 3*10000/20000 = 1.5 -> 2
    expect(taxIncludedIn(3, 10000)).toEqual({ taxablePaise: 2, taxPaise: 1 });
    // gross=1, rate=10000: 0.5 -> 1
    expect(taxIncludedIn(1, 10000)).toEqual({ taxablePaise: 1, taxPaise: 0 });
  });

  it("is exact for very large amounts (no float drift)", () => {
    const gross = 9_007_199_254_740_000; // near MAX_SAFE_INTEGER
    const { taxablePaise, taxPaise } = taxIncludedIn(gross, 1800);
    expect(taxablePaise + taxPaise).toBe(gross);
    const exact = (BigInt(gross) * 10000n * 2n + 11800n) / (2n * 11800n);
    expect(BigInt(taxablePaise)).toBe(exact);
  });

  it.each([0, 300, 500, 1200, 1800, 2800])(
    "taxable + tax === gross and tax >= 0 for 0..5000 paise @ %i bp",
    (rate) => {
      let prevTaxable = -1;
      for (let gross = 0; gross <= 5000; gross++) {
        const { taxablePaise, taxPaise } = taxIncludedIn(gross, rate);
        expect(taxablePaise + taxPaise).toBe(gross);
        expect(taxPaise).toBeGreaterThanOrEqual(0);
        expect(taxablePaise).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(taxablePaise)).toBe(true);
        // monotonic non-decreasing taxable
        expect(taxablePaise).toBeGreaterThanOrEqual(prevTaxable);
        prevTaxable = taxablePaise;
        // taxable matches the exact round-half-up definition
        const expected = Math.floor((2 * gross * 10000 + (10000 + rate)) / (2 * (10000 + rate)));
        expect(taxablePaise).toBe(expected);
      }
    },
  );

  it("rejects invalid input", () => {
    expect(() => taxIncludedIn(-1, 1800)).toThrow(TaxError);
    expect(() => taxIncludedIn(1.5, 1800)).toThrow(TaxError);
    expect(() => taxIncludedIn(100, -1)).toThrow(TaxError);
    expect(() => taxIncludedIn(100, 18.5)).toThrow(TaxError);
    expect(() => taxIncludedIn(Number.NaN, 1800)).toThrow(TaxError);
    expect(() => taxIncludedIn(Number.MAX_SAFE_INTEGER + 1, 1800)).toThrow(TaxError);
  });
});

describe("splitGst", () => {
  const intra = { sellerStateCode: "27", buyerStateCode: "27" };
  const inter = { sellerStateCode: "27", buyerStateCode: "29" };

  it("splits intra-state evenly", () => {
    expect(splitGst(1800, intra)).toEqual({ cgst: 900, sgst: 900, igst: 0 });
    expect(splitGst(0, intra)).toEqual({ cgst: 0, sgst: 0, igst: 0 });
  });

  it("gives the odd paisa to SGST", () => {
    expect(splitGst(15, intra)).toEqual({ cgst: 7, sgst: 8, igst: 0 });
    expect(splitGst(1, intra)).toEqual({ cgst: 0, sgst: 1, igst: 0 });
  });

  it("uses IGST inter-state", () => {
    expect(splitGst(1883, inter)).toEqual({ cgst: 0, sgst: 0, igst: 1883 });
  });

  it("always sums back to the tax", () => {
    for (let t = 0; t < 500; t++) {
      const a = splitGst(t, intra);
      expect(a.cgst + a.sgst + a.igst).toBe(t);
      expect(a.sgst - a.cgst).toBeLessThanOrEqual(1);
      const b = splitGst(t, inter);
      expect(b.cgst + b.sgst + b.igst).toBe(t);
    }
  });

  it("validates inputs", () => {
    expect(() => splitGst(-1, intra)).toThrow(TaxError);
    expect(() => splitGst(1.2, intra)).toThrow(TaxError);
    expect(() => splitGst(10, { sellerStateCode: "7", buyerStateCode: "27" })).toThrow(TaxError);
    expect(() => splitGst(10, { sellerStateCode: "27", buyerStateCode: "MH" })).toThrow(TaxError);
  });
});
