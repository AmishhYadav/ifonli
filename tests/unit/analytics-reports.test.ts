import { describe, expect, it } from "vitest";

import { csvCell, rupees, toCsv } from "@/lib/csv";
import {
  addDays,
  bucketKey,
  diffDays,
  enumerateBuckets,
  fillBuckets,
  isIstDay,
  parseDateRange,
  rangeBounds,
  rangeDays,
  weekStart,
} from "@/server/services/analytics/dates";
import { buildFunnel, formatPercent } from "@/server/services/analytics/funnel";
import {
  DEFAULT_THRESHOLDS,
  addToCartRate,
  benchmarks,
  ctr,
  findInsights,
  purchaseRate,
  reached75Rate,
  type ProductEngagement,
} from "@/server/services/analytics/insight-rules";
import { funnelCsv, salesCsv, topCsv } from "@/server/services/analytics/report-csv";
import { retentionCutoff } from "@/server/services/analytics/rollup";

describe("IST date bucketing", () => {
  it("puts an instant on its India calendar day, not its UTC day", () => {
    // 19:00 UTC on 31 Oct is 00:30 IST on 1 Nov.
    expect(bucketKey(new Date("2026-10-31T19:00:00Z"), "day")).toBe("2026-11-01");
    // 18:29 UTC is 23:59 IST, still 31 Oct.
    expect(bucketKey(new Date("2026-10-31T18:29:59Z"), "day")).toBe("2026-10-31");
    expect(bucketKey(new Date("2026-10-31T18:30:00Z"), "day")).toBe("2026-11-01");
  });

  it("names weeks by their Monday (IST)", () => {
    // 1 Nov 2026 is a Sunday: its week started Monday 26 Oct.
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    // Sunday 00:30 IST is still Saturday in UTC, but the week is the same either way here; check a Monday edge.
    expect(bucketKey(new Date("2026-11-01T19:00:00Z"), "week")).toBe("2026-11-02"); // Mon 00:30 IST
    expect(bucketKey(new Date("2026-11-01T18:00:00Z"), "week")).toBe("2026-10-26"); // Sun 23:30 IST
  });

  it("does day arithmetic across months and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(diffDays("2026-10-01", "2026-10-31")).toBe(30);
  });

  it("enumerates every bucket in a range", () => {
    const range = { from: "2026-10-29", to: "2026-11-02" };
    expect(enumerateBuckets(range, "day")).toEqual(["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(enumerateBuckets(range, "week")).toEqual(["2026-10-26", "2026-11-02"]);
    expect(rangeDays(range)).toBe(5);
  });

  it("fills gaps with empty rows and keeps real ones", () => {
    const rows = [{ bucket: "2026-10-30", n: 4 }];
    const filled = fillBuckets({ from: "2026-10-29", to: "2026-10-31" }, "day", rows, (bucket) => ({ bucket, n: 0 }));
    expect(filled).toEqual([
      { bucket: "2026-10-29", n: 0 },
      { bucket: "2026-10-30", n: 4 },
      { bucket: "2026-10-31", n: 0 },
    ]);
  });

  it("turns a range into IST midnight instants, end exclusive", () => {
    const { start, end } = rangeBounds({ from: "2026-11-01", to: "2026-11-01" });
    expect(start.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-11-01T18:30:00.000Z");
  });

  it("validates real calendar days only", () => {
    expect(isIstDay("2026-02-28")).toBe(true);
    expect(isIstDay("2026-02-30")).toBe(false);
    expect(isIstDay("2026-2-3")).toBe(false);
    expect(isIstDay(undefined)).toBe(false);
  });
});

describe("parseDateRange", () => {
  const now = new Date("2026-11-01T02:00:00Z"); // 07:30 IST on 1 Nov
  it("defaults to the last 30 days ending today (IST)", () => {
    expect(parseDateRange({}, now)).toEqual({ from: "2026-10-03", to: "2026-11-01" });
  });
  it("uses today in India, not in UTC", () => {
    expect(parseDateRange({}, new Date("2026-10-31T20:00:00Z")).to).toBe("2026-11-01");
  });
  it("accepts a valid range and ignores junk", () => {
    expect(parseDateRange({ from: "2026-10-01", to: "2026-10-15" }, now)).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(parseDateRange({ from: "nope", to: "also-nope" }, now)).toEqual({ from: "2026-10-03", to: "2026-11-01" });
    expect(parseDateRange({ from: "2026-10-20", to: "2026-10-01" }, now)).toEqual({ from: "2026-10-03", to: "2026-11-01" });
  });
  it("caps a range at a year", () => {
    const r = parseDateRange({ from: "2020-01-01", to: "2026-10-01" }, now);
    expect(r.to).toBe("2026-10-01");
    expect(rangeDays(r)).toBe(366);
  });
  it("takes the first value of repeated params", () => {
    expect(parseDateRange({ from: ["2026-10-01", "2026-09-01"], to: "2026-10-02" }, now)).toEqual({ from: "2026-10-01", to: "2026-10-02" });
  });
});

describe("retention cutoff", () => {
  it("goes back whole calendar months and clamps the day", () => {
    expect(retentionCutoff(new Date("2026-11-15T10:00:00Z"), 13).toISOString()).toBe("2025-10-15T10:00:00.000Z");
    expect(retentionCutoff(new Date("2026-03-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(retentionCutoff(new Date("2026-01-10T00:00:00Z"), 1).toISOString()).toBe("2025-12-10T00:00:00.000Z");
    expect(retentionCutoff(new Date("2026-05-31T00:00:00Z"), 12).toISOString()).toBe("2025-05-31T00:00:00.000Z");
  });
});

describe("funnel maths", () => {
  it("computes shares of the start and of the previous step", () => {
    const steps = buildFunnel({ sessions: 1000, pdp: 400, cart: 100, checkout: 50, purchase: 25 });
    expect(steps.map((s) => s.count)).toEqual([1000, 400, 100, 50, 25]);
    expect(steps[1]).toMatchObject({ ofStart: 0.4, ofPrevious: 0.4, dropped: 600 });
    expect(steps[2]).toMatchObject({ ofStart: 0.1, ofPrevious: 0.25, dropped: 300 });
    expect(steps[4]).toMatchObject({ ofStart: 0.025, ofPrevious: 0.5, dropped: 25 });
    expect(steps[0]).toMatchObject({ ofStart: 1, ofPrevious: null, dropped: 0 });
  });
  it("never goes up and survives an empty funnel", () => {
    const odd = buildFunnel({ sessions: 10, pdp: 12, cart: 3, checkout: 5, purchase: 0 });
    expect(odd.map((s) => s.count)).toEqual([10, 10, 3, 3, 0]);
    const empty = buildFunnel({ sessions: 0, pdp: 0, cart: 0, checkout: 0, purchase: 0 });
    expect(empty.every((s) => s.ofStart === null && s.ofPrevious === null)).toBe(true);
    expect(formatPercent(null)).toBe("-");
    expect(formatPercent(0.1234)).toBe("12.3%");
  });
});

const product = (over: Partial<ProductEngagement> & { name: string }): ProductEngagement => ({
  productId: over.name,
  slug: over.name.toLowerCase(),
  impressions: 0,
  clicks: 0,
  pdpViews: 0,
  uniqueViewers: 0,
  avgScrollDepth: 0,
  reached75Pct: 0,
  addToCarts: 0,
  purchases: 0,
  revenuePaise: 0,
  ...over,
});

describe("insight rules", () => {
  it("computes rates and handles zero denominators", () => {
    expect(ctr({ clicks: 5, impressions: 100 })).toBe(0.05);
    expect(ctr({ clicks: 5, impressions: 0 })).toBeNull();
    expect(addToCartRate({ addToCarts: 3, pdpViews: 12 })).toBe(0.25);
    expect(purchaseRate({ purchases: 1, addToCarts: 0 })).toBeNull();
    expect(reached75Rate({ reached75Pct: 3, uniqueViewers: 4 })).toBe(0.75);
  });

  it("uses catalogue totals as the benchmark", () => {
    const b = benchmarks([
      product({ name: "A", impressions: 100, clicks: 10, pdpViews: 10, addToCarts: 5 }),
      product({ name: "B", impressions: 300, clicks: 10, pdpViews: 30, addToCarts: 5 }),
    ]);
    expect(b.ctr).toBe(0.05);
    expect(b.addToCartRate).toBe(0.25);
  });

  const rows = [
    product({ name: "Good", impressions: 500, clicks: 50, pdpViews: 100, addToCarts: 30, purchases: 20 }),
    product({ name: "Ignored", impressions: 500, clicks: 50, pdpViews: 100, addToCarts: 30, purchases: 20 }),
    // seen a lot, almost never clicked
    product({ name: "Hidden", impressions: 1000, clicks: 5, pdpViews: 10, addToCarts: 3 }),
    // viewed a lot, almost never added
    product({ name: "Pricey", impressions: 200, clicks: 20, pdpViews: 200, addToCarts: 6 }),
    // carted a lot, never bought
    product({ name: "Stuck", impressions: 300, clicks: 30, pdpViews: 60, addToCarts: 30, purchases: 0 }),
  ];

  it("flags high impressions with low CTR, high views with low add-to-cart, and carts that do not convert", () => {
    const found = findInsights(rows);
    const kinds = Object.fromEntries(found.map((f) => [`${f.kind}:${f.name}`, f]));
    expect(kinds["low_ctr:Hidden"]).toBeDefined();
    expect(kinds["low_add_to_cart:Pricey"]).toBeDefined();
    expect(kinds["low_purchase:Stuck"]).toBeDefined();
    expect(found.some((f) => f.name === "Good" || f.name === "Ignored")).toBe(false);
  });

  it("needs a minimum sample before it flags anything", () => {
    const thin = [
      product({ name: "Normal", impressions: 500, clicks: 50, pdpViews: 100, addToCarts: 30 }),
      product({ name: "Tiny", impressions: DEFAULT_THRESHOLDS.minImpressions - 1, clicks: 0, pdpViews: 5, addToCarts: 0 }),
    ];
    expect(findInsights(thin)).toEqual([]);
  });

  it("returns nothing when the catalogue has no baseline", () => {
    expect(findInsights([])).toEqual([]);
    expect(findInsights([product({ name: "Zero", impressions: 1000, clicks: 0 })])).toEqual([]);
  });

  it("ranks by missed opportunity", () => {
    const found = findInsights(rows);
    for (let i = 1; i < found.length; i++) expect(found[i - 1]!.missed).toBeGreaterThanOrEqual(found[i]!.missed);
    const hidden = found.find((f) => f.kind === "low_ctr" && f.name === "Hidden")!;
    expect(hidden.sample).toBe(1000);
    expect(hidden.rate).toBeCloseTo(0.005);
    expect(hidden.missed).toBeGreaterThan(0);
  });
});

describe("CSV", () => {
  it("quotes fields and guards against spreadsheet formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(x)")).toBe("'=HYPERLINK(x)");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });
  it("writes CRLF rows with a header and rupees with two decimals", () => {
    expect(toCsv(["A", "B"], [[1, "x"]])).toBe("A,B\r\n1,x\r\n");
    expect(rupees(129900)).toBe("1299.00");
    expect(rupees(5)).toBe("0.05");
  });
  it("renders the report CSVs", () => {
    const sales = salesCsv({
      bucket: "day",
      points: [{ bucket: "2026-11-01", orders: 2, revenuePaise: 259800, discountPaise: 10000, aovPaise: 129900 }],
      totals: { orders: 2, revenuePaise: 259800, discountPaise: 10000, aovPaise: 129900 },
    });
    expect(sales).toBe(
      "Day,Orders,Revenue (INR),Discounts (INR),Average order value (INR)\r\n2026-11-01,2,2598.00,100.00,1299.00\r\n",
    );
    expect(topCsv("Product", [{ key: "p", name: "=bad", orders: 1, units: 2, revenuePaise: 100 }])).toContain("'=bad,1,2,1.00");
    expect(funnelCsv(buildFunnel({ sessions: 4, pdp: 2, cart: 1, checkout: 1, purchase: 0 }))).toContain("Viewed a product,2,50.00,50.00,2");
  });
});
