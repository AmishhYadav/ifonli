import { describe, expect, it } from "vitest";

import {
  financialYear,
  formatIstDate,
  formatInvoiceNumber,
  generateOrderRef,
  isValidOrderRef,
  istDateString,
  istParts,
  normalizeOrderRef,
  ORDER_REF_ALPHABET,
} from "@/server/domain";

describe("ORDER_REF_ALPHABET", () => {
  it("is Crockford base32 without I, L, O, U", () => {
    expect(ORDER_REF_ALPHABET).toHaveLength(32);
    expect(new Set(ORDER_REF_ALPHABET).size).toBe(32);
    for (const c of "ILOU") {
      expect(ORDER_REF_ALPHABET).not.toContain(c);
    }
    expect(ORDER_REF_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
  });
});

describe("generateOrderRef", () => {
  const now = new Date("2026-11-15T10:00:00Z");

  it("has the IFO-YYMM-XXXX shape and validates", () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateOrderRef(now);
      expect(ref).toMatch(/^IFO-2611-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(isValidOrderRef(ref)).toBe(true);
    }
  });

  it("is deterministic with an injected rand", () => {
    const seq = [0, 31, 10, 1];
    let i = 0;
    expect(generateOrderRef(now, () => seq[i++] as number)).toBe("IFO-2611-0ZA1");
  });

  it("rejects an out-of-range rand", () => {
    expect(() => generateOrderRef(now, () => 32)).toThrow(RangeError);
    expect(() => generateOrderRef(now, () => -1)).toThrow(RangeError);
    expect(() => generateOrderRef(now, () => 1.5)).toThrow(RangeError);
  });

  it("uses the IST month: 2026-10-31T19:00Z is already November 1 in India", () => {
    expect(generateOrderRef(new Date("2026-10-31T19:00:00Z"), () => 0)).toBe("IFO-2611-0000");
    // one minute before IST midnight is still October
    expect(generateOrderRef(new Date("2026-10-31T18:29:59Z"), () => 0)).toBe("IFO-2610-0000");
    expect(generateOrderRef(new Date("2026-10-31T18:30:00Z"), () => 0)).toBe("IFO-2611-0000");
  });

  it("rolls the year in IST", () => {
    expect(generateOrderRef(new Date("2026-12-31T18:30:00Z"), () => 0)).toBe("IFO-2701-0000");
    expect(generateOrderRef(new Date("2026-12-31T18:29:59Z"), () => 0)).toBe("IFO-2612-0000");
    expect(generateOrderRef(new Date("2005-03-01T00:00:00Z"), () => 0)).toBe("IFO-0503-0000");
  });

  it("every alphabet char is reachable", () => {
    let n = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const ref = generateOrderRef(now, () => n++ % 32);
      for (const ch of ref.slice(-4)) seen.add(ch);
    }
    expect(seen.size).toBe(32);
  });
});

describe("isValidOrderRef / normalizeOrderRef", () => {
  it.each(["IFO-2611-7K3Q", "IFO-2601-0000", "IFO-2612-ZZZZ"])("accepts %s", (ref) => {
    expect(isValidOrderRef(ref)).toBe(true);
  });

  it.each([
    "IFO-2613-7K3Q", // month 13
    "IFO-2600-7K3Q", // month 00
    "IFO-2611-7K3I", // I
    "IFO-2611-7K3L", // L
    "IFO-2611-7K3O", // O
    "IFO-2611-7K3U", // U
    "IFO-2611-7k3q", // lower case
    "IFO-2611-7K3",
    "IFO-2611-7K3QQ",
    "IFO-261-7K3Q",
    "ifo-2611-7K3Q",
    "IFO-2611-7K3Q\n",
    " IFO-2611-7K3Q",
    "",
  ])("rejects %j", (ref) => {
    expect(isValidOrderRef(ref)).toBe(false);
  });

  it("normalises user-typed refs", () => {
    expect(normalizeOrderRef("  ifo-2611-7k3q ")).toBe("IFO-2611-7K3Q");
  });
});

describe("financialYear", () => {
  it("runs 1 April - 31 March in IST", () => {
    expect(financialYear(new Date("2026-04-01T00:00:00+05:30"))).toEqual({
      startYear: 2026,
      label: "26-27",
    });
    expect(financialYear(new Date("2027-03-31T23:59:59+05:30"))).toEqual({
      startYear: 2026,
      label: "26-27",
    });
    expect(financialYear(new Date("2027-04-01T00:00:00+05:30"))).toEqual({
      startYear: 2027,
      label: "27-28",
    });
  });

  it("flips at 18:30 UTC on 31 March (IST midnight)", () => {
    expect(financialYear(new Date("2027-03-31T18:29:59Z")).label).toBe("26-27");
    expect(financialYear(new Date("2027-03-31T18:30:00Z")).label).toBe("27-28");
    // the spec's example: 2027-03-31T20:00Z is 01:30 IST on 1 April -> FY 27-28
    expect(financialYear(new Date("2027-03-31T20:00:00Z")).label).toBe("27-28");
  });

  it("handles January-March and the century wrap", () => {
    expect(financialYear(new Date("2026-01-15T00:00:00Z")).label).toBe("25-26");
    expect(financialYear(new Date("2099-06-01T00:00:00Z")).label).toBe("99-00");
  });

  it("covers the start of the FY for UTC dates still in March", () => {
    expect(financialYear(new Date("2026-03-31T18:29:59Z")).label).toBe("25-26");
    expect(financialYear(new Date("2026-03-31T18:30:00Z")).label).toBe("26-27");
  });
});

describe("formatInvoiceNumber", () => {
  const now = new Date("2026-11-15T10:00:00Z");

  it("formats IFO/YY-YY/000123", () => {
    expect(formatInvoiceNumber(123, now)).toBe("IFO/26-27/000123");
    expect(formatInvoiceNumber(1, now)).toBe("IFO/26-27/000001");
    expect(formatInvoiceNumber(999_999, now)).toBe("IFO/26-27/999999");
  });

  it("is exactly 16 characters (GST limit)", () => {
    expect(formatInvoiceNumber(42, now)).toHaveLength(16);
  });

  it("uses the FY of the IST date at the boundary", () => {
    expect(formatInvoiceNumber(5, new Date("2027-03-31T18:29:59Z"))).toBe("IFO/26-27/000005");
    expect(formatInvoiceNumber(1, new Date("2027-03-31T18:30:00Z"))).toBe("IFO/27-28/000001");
  });

  it("rejects bad sequences", () => {
    for (const bad of [0, -1, 1.5, 1_000_000, Number.NaN]) {
      expect(() => formatInvoiceNumber(bad, now)).toThrow(RangeError);
    }
  });
});

describe("IST helpers", () => {
  it("istParts returns India wall-clock parts", () => {
    expect(istParts(new Date("2026-10-31T19:00:00Z"))).toEqual({
      year: 2026,
      month: 11,
      day: 1,
      weekday: 0,
    });
    expect(istParts(new Date("2026-11-02T00:00:00Z"))).toEqual({
      year: 2026,
      month: 11,
      day: 2,
      weekday: 1,
    });
  });

  it("formats dates", () => {
    expect(formatIstDate(new Date("2026-10-31T19:00:00Z"))).toBe("1 Nov 2026");
    expect(formatIstDate(new Date("2026-01-09T00:00:00Z"))).toBe("9 Jan 2026");
    expect(istDateString(new Date("2026-10-31T19:00:00Z"))).toBe("2026-11-01");
    expect(istDateString(new Date("2026-01-09T00:00:00Z"))).toBe("2026-01-09");
  });

  it("rejects invalid dates", () => {
    expect(() => istParts(new Date("nope"))).toThrow(RangeError);
  });
});
