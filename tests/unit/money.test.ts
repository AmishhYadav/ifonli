import { describe, expect, it } from "vitest";

import { formatINR, paiseToRupees, rupeesToPaise, sumPaise } from "@/lib/money";

describe("formatINR", () => {
  it("shows no decimals for whole rupees", () => {
    expect(formatINR(129900)).toBe("₹1,299");
    expect(formatINR(0)).toBe("₹0");
  });

  it("shows two decimals when there are paise", () => {
    expect(formatINR(129950)).toBe("₹1,299.50");
    expect(formatINR(5)).toBe("₹0.05");
  });

  it("uses Indian digit grouping", () => {
    expect(formatINR(12345678900)).toBe("₹12,34,56,789");
  });

  it("accepts bigint and negatives", () => {
    expect(formatINR(129900n)).toBe("₹1,299");
    expect(formatINR(-15050)).toBe("-₹150.50");
  });
});

describe("rupeesToPaise / paiseToRupees", () => {
  it("converts and rounds safely", () => {
    expect(rupeesToPaise(1299)).toBe(129900);
    expect(rupeesToPaise(12.99)).toBe(1299);
    expect(rupeesToPaise(1.005)).toBe(101);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(rupeesToPaise(-2.5)).toBe(-250);
  });

  it("rejects non-finite input", () => {
    expect(() => rupeesToPaise(Number.NaN)).toThrow(RangeError);
  });

  it("round-trips", () => {
    expect(paiseToRupees(rupeesToPaise(499.5))).toBe(499.5);
    expect(paiseToRupees(10n)).toBe(0.1);
  });
});

describe("sumPaise", () => {
  it("sums integers exactly", () => {
    expect(sumPaise([])).toBe(0);
    expect(sumPaise([10, 20, 30])).toBe(60);
    expect(sumPaise([129900, -9900])).toBe(120000);
  });

  it("rejects non-integer paise", () => {
    expect(() => sumPaise([1.5])).toThrow(RangeError);
  });
});
