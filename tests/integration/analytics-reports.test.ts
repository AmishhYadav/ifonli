import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { analyticsEvents, orders, productEngagementDaily, user } from "@/server/db/schema";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import { cancelOrder } from "@/server/services/admin/orders";
import { getInsights } from "@/server/services/analytics/insights";
import { couponsCsv, funnelCsv, salesCsv, statusCsv, topCsv } from "@/server/services/analytics/report-csv";
import {
  getCouponPerformance,
  getFunnel,
  getOrdersByStatus,
  getSalesReport,
  getTopProducts,
  getTopTypes,
  getTopVibes,
} from "@/server/services/analytics/reports";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import {
  configureCommerce,
  makeCoupon,
  placeCodOrder,
  placePaidOrder,
  placePrepaidOrder,
  seedCommerceReference,
} from "./helpers/factories";

const db = () => getDb();
const owner = { id: "owner-1", role: "owner" };
let f: Fixture;
let provider: MockPaymentProvider;

beforeEach(async () => {
  provider = new MockPaymentProvider({ deterministic: true });
  setPaymentProvider(provider);
  await db().insert(user).values({ id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" });
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});
afterEach(() => setPaymentProvider(null));

const placedAt = (orderId: string, at: string) =>
  db().update(orders).set({ placedAt: new Date(at) }).where(eq(orders.id, orderId));

const RANGE = { from: "2026-10-30", to: "2026-11-03" };

/** Orders (all COD unless noted): A 30 Oct, B 31 Oct 23:30 IST, C 1 Nov 00:30 IST (same instant day as B in UTC), D (paid) 3 Nov, E cancelled, F outside. */
async function seedSales() {
  const a = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
  await placedAt(a.order.orderId, "2026-10-30T06:00:00Z");
  const b = await placeCodOrder([{ variantId: f.variants.cat!, qty: 2 }]);
  await placedAt(b.order.orderId, "2026-10-31T18:00:00Z"); // 31 Oct 23:30 IST
  const c = await placeCodOrder([{ variantId: f.variants.spiky!, qty: 1 }]);
  await placedAt(c.order.orderId, "2026-10-31T19:00:00Z"); // 1 Nov 00:30 IST
  const d = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
  await placedAt(d.order.orderId, "2026-11-03T05:00:00Z");
  const e = await placeCodOrder([{ variantId: f.variants.ghost!, qty: 1 }]);
  await placedAt(e.order.orderId, "2026-11-01T06:00:00Z");
  await cancelOrder(db(), e.order.orderId, { reason: "test" }, owner, provider);
  const pending = await placePrepaidOrder(provider, [{ variantId: f.variants.ghost!, qty: 1 }]);
  await placedAt(pending.order.orderId, "2026-11-02T06:00:00Z");
  const outside = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
  await placedAt(outside.order.orderId, "2026-09-01T06:00:00Z");
  return { a, b, c, d, e, pending };
}

describe("sales report", () => {
  it("buckets by India day, fills empty days and counts only real sales", async () => {
    const o = await seedSales();
    const r = await getSalesReport(db(), RANGE, "day");
    expect(r.points.map((p) => p.bucket)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(r.points.map((p) => p.orders)).toEqual([1, 1, 1, 0, 1]);
    expect(r.points[0]!.revenuePaise).toBe(o.a.order.totalPaise);
    expect(r.points[1]!.revenuePaise).toBe(o.b.order.totalPaise); // 23:30 IST on the 31st, not the 1st
    expect(r.points[2]!.revenuePaise).toBe(o.c.order.totalPaise); // 00:30 IST on the 1st although still 31 Oct in UTC
    expect(r.points[3]).toEqual({ bucket: "2026-11-02", orders: 0, revenuePaise: 0, discountPaise: 0, aovPaise: null });
    const total = o.a.order.totalPaise + o.b.order.totalPaise + o.c.order.totalPaise + o.d.order.totalPaise;
    expect(r.totals).toMatchObject({ orders: 4, revenuePaise: total, aovPaise: Math.round(total / 4) });
  });

  it("buckets by week starting Monday (IST)", async () => {
    const o = await seedSales();
    const r = await getSalesReport(db(), RANGE, "week");
    // 30 Oct is a Friday: weeks start 26 Oct and 2 Nov.
    expect(r.points.map((p) => p.bucket)).toEqual(["2026-10-26", "2026-11-02"]);
    expect(r.points[0]!.orders).toBe(3);
    expect(r.points[1]).toMatchObject({ orders: 1, revenuePaise: o.d.order.totalPaise });
  });

  it("is empty and zeroed with no orders", async () => {
    const r = await getSalesReport(db(), RANGE, "day");
    expect(r.totals).toEqual({ orders: 0, revenuePaise: 0, discountPaise: 0, aovPaise: null });
    expect(r.points).toHaveLength(5);
  });
});

describe("orders by status", () => {
  it("includes cancelled and unpaid orders, grouped by status, payment status and method", async () => {
    await seedSales();
    const r = await getOrdersByStatus(db(), RANGE);
    const by = (rows: { status: string; orders: number }[]) => Object.fromEntries(rows.map((x) => [x.status, x.orders]));
    expect(by(r.byStatus)).toEqual({ confirmed: 4, cancelled: 1, pending_payment: 1 });
    expect(by(r.byMethod)).toEqual({ cod: 4, razorpay: 2 });
    expect(by(r.byPayment)).toMatchObject({ paid: 1, unpaid: 1 });
    expect(r.byStatus.reduce((n, x) => n + x.valuePaise, 0)).toBeGreaterThan(0);
  });
});

describe("top products, vibes, types", () => {
  it("ranks by revenue from counted orders only", async () => {
    const o = await seedSales();
    const top = await getTopProducts(db(), RANGE);
    expect(top.map((t) => t.name)).toEqual(["Skull Charm", "Spiky Charm", "Cat Sticker"]);
    expect(top[0]).toMatchObject({ orders: 2, units: 3, revenuePaise: 3 * 19900 }); // A (1) + D (2)
    expect(top[2]).toMatchObject({ units: 2, revenuePaise: 2 * 9900 });
    expect(top.find((t) => t.name === "Ghost Sticker")).toBeUndefined(); // cancelled / unpaid

    const vibes = await getTopVibes(db(), RANGE);
    const gothic = vibes.find((v) => v.key === "gothic")!;
    const bold = vibes.find((v) => v.key === "bold")!;
    const cute = vibes.find((v) => v.key === "cute")!;
    // skull is gothic + bold, spiky is bold, cat is cute
    expect(gothic.revenuePaise).toBe(3 * 19900);
    expect(bold.revenuePaise).toBe(3 * 19900 + 24900);
    expect(cute.revenuePaise).toBe(2 * 9900);

    const types = await getTopTypes(db(), RANGE);
    expect(Object.fromEntries(types.map((t) => [t.key, t.revenuePaise]))).toEqual({
      charms: 3 * 19900 + 24900,
      "3d-stickers": 2 * 9900,
    });
    expect(o.a.order.orderId).toBeTruthy();
  });
});

describe("coupon performance", () => {
  it("groups sales by code (case-insensitive) with discount totals", async () => {
    const coupon = await makeCoupon({ code: "Save10", kind: "percent", value: 1000 });
    const x = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }], { couponCode: coupon.code });
    const y = await placeCodOrder([{ variantId: f.variants.spiky!, qty: 1 }], { couponCode: coupon.code });
    await placeCodOrder([{ variantId: f.variants.cat!, qty: 1 }]); // no coupon
    for (const o of [x, y]) await placedAt(o.order.orderId, "2026-10-31T06:00:00Z");

    const rows = await getCouponPerformance(db(), RANGE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "SAVE10", orders: 2 });
    expect(rows[0]!.discountPaise).toBeGreaterThan(0);
    expect(rows[0]!.discountPaise).toBe(1990 + 2490);
    expect(rows[0]!.discountRate).toBeCloseTo(0.1, 2);
  });
});

describe("funnel", () => {
  const range = { from: "2026-11-01", to: "2026-11-01" };
  const at = "2026-11-01T06:00:00Z";
  const s = (n: number) => `session${String(n).padStart(24, "0")}`;
  async function sess(n: number, events: string[], when = at) {
    await db()
      .insert(analyticsEvents)
      .values(events.map((event) => ({ sessionId: s(n), event, ts: new Date(when) })));
  }

  it("counts sessions per stage, nested, within the India day", async () => {
    await sess(1, ["page_view"]);
    await sess(2, ["page_view", "pdp_view"]);
    await sess(3, ["page_view", "pdp_view", "add_to_cart"]);
    await sess(4, ["page_view", "pdp_view", "add_to_cart", "begin_checkout"]);
    await sess(5, ["page_view", "pdp_view", "add_to_cart", "begin_checkout", "purchase"]);
    await sess(6, ["page_view", "page_view", "pdp_view", "pdp_view"]); // duplicates count once
    await sess(7, ["add_to_cart", "begin_checkout", "purchase"]); // never seen a page_view: not in the funnel
    await sess(8, ["page_view", "pdp_view"], "2026-11-01T18:45:00Z"); // 2 Nov 00:15 IST: outside
    const steps = await getFunnel(db(), range);
    expect(steps.map((x) => [x.key, x.count])).toEqual([
      ["sessions", 6],
      ["pdp", 5],
      ["cart", 3],
      ["checkout", 2],
      ["purchase", 1],
    ]);
    expect(steps[1]!.ofPrevious).toBeCloseTo(5 / 6);
    expect(steps[4]).toMatchObject({ ofStart: 1 / 6, ofPrevious: 0.5, dropped: 1 });
  });

  it("is all zeros with no events", async () => {
    const steps = await getFunnel(db(), range);
    expect(steps.every((x) => x.count === 0 && x.ofStart === null)).toBe(true);
  });
});

describe("insights", () => {
  const day = (d: string) => d;
  async function engagement(slug: string, date: string, v: Partial<typeof productEngagementDaily.$inferInsert>) {
    await db().insert(productEngagementDaily).values({ date: day(date), productId: f.products[slug]!, ...v });
  }

  it("sums engagement over the range and flags weak products", async () => {
    await engagement("skull-charm", "2026-10-31", { impressions: 600, clicks: 60, pdpViews: 100, uniqueViewers: 80, avgScrollDepth: 60, reached75Pct: 20, addToCarts: 30, purchases: 20, revenuePaise: 398000 });
    await engagement("skull-charm", "2026-11-01", { impressions: 400, clicks: 40, pdpViews: 100, uniqueViewers: 80, avgScrollDepth: 40, reached75Pct: 20, addToCarts: 30, purchases: 20, revenuePaise: 398000 });
    await engagement("cat-sticker", "2026-11-01", { impressions: 1000, clicks: 5, pdpViews: 10, uniqueViewers: 8, addToCarts: 2 });
    await engagement("spiky-charm", "2026-11-01", { impressions: 100, clicks: 20, pdpViews: 200, uniqueViewers: 150, addToCarts: 6 });
    await engagement("heart-charm", "2026-09-01", { impressions: 9999 }); // outside the range

    const data = await getInsights(db(), { from: "2026-10-31", to: "2026-11-01" });
    expect(data.vibes.map((v) => v.slug)).toEqual(["cute", "bold", "gothic"]);
    const skull = data.products.find((p) => p.name === "Skull Charm")!;
    expect(skull).toMatchObject({ impressions: 1000, clicks: 100, pdpViews: 200, uniqueViewers: 160, reached75Pct: 40, addToCarts: 60, purchases: 40, revenuePaise: 796000 });
    expect(skull.avgScrollDepth).toBeCloseTo(50);
    expect(data.products.some((p) => p.name === "Heart Charm")).toBe(false);
    expect(data.totals).toMatchObject({ impressions: 2100, clicks: 125, pdpViews: 410 });

    const kinds = data.findings.map((x) => `${x.kind}:${x.name}`);
    expect(kinds).toContain("low_ctr:Cat Sticker");
    expect(kinds).toContain("low_add_to_cart:Spiky Charm");
    expect(kinds.some((k) => k.endsWith("Skull Charm"))).toBe(false);
    expect(data.rollupPending).toBe(false);
  });

  it("filters to a vibe (products filed under it) and sums vibe performance", async () => {
    await engagement("skull-charm", "2026-11-01", { impressions: 100, clicks: 10, pdpViews: 10, addToCarts: 2, revenuePaise: 19900, purchases: 1 });
    await engagement("cat-sticker", "2026-11-01", { impressions: 50, clicks: 5 });
    await db().insert(analyticsEvents).values([
      { sessionId: "x".repeat(20), event: "vibe_switch", vibe: "gothic", ts: new Date("2026-11-01T06:00:00Z") },
      { sessionId: "y".repeat(20), event: "vibe_switch", vibe: "gothic", ts: new Date("2026-11-01T07:00:00Z") },
      { sessionId: "z".repeat(20), event: "vibe_switch", vibe: "cute", ts: new Date("2026-11-01T07:00:00Z") },
    ]);
    const all = await getInsights(db(), { from: "2026-11-01", to: "2026-11-01" });
    const perf = Object.fromEntries(all.vibePerformance.map((v) => [v.slug, v]));
    expect(perf.gothic).toMatchObject({ impressions: 100, switchesTo: 2, revenuePaise: 19900 });
    expect(perf.bold).toMatchObject({ impressions: 100 }); // skull is gothic and bold
    expect(perf.cute).toMatchObject({ impressions: 50, switchesTo: 1 });

    const cute = await getInsights(db(), { from: "2026-11-01", to: "2026-11-01" }, { vibe: "cute" });
    expect(cute.products.map((p) => p.name)).toEqual(["Cat Sticker"]);
    expect(cute.vibePerformance.map((v) => v.slug)).toEqual(["cute"]);
  });

  it("reports searches without results, top searches and hero tile clicks from raw events", async () => {
    const ts = new Date("2026-11-01T06:00:00Z");
    const sid = "q".repeat(20);
    await db().insert(analyticsEvents).values([
      { sessionId: sid, event: "search", value: 0, meta: { q: "dragon" }, ts },
      { sessionId: sid, event: "search", value: 0, meta: { q: "dragon" }, ts },
      { sessionId: sid, event: "search", value: 0, meta: { q: "unicorn" }, ts },
      { sessionId: sid, event: "search", value: 4, meta: { q: "charm" }, ts },
      { sessionId: sid, event: "search", value: 2, ts }, // no term kept
      { sessionId: sid, event: "hero_tile_click", vibe: "cute", meta: { tile: "3" }, ts },
      { sessionId: sid, event: "hero_tile_click", vibe: "cute", meta: { tile: "3" }, ts },
      { sessionId: sid, event: "hero_tile_click", vibe: "gothic", meta: { tile: "1" }, ts },
      { sessionId: sid, event: "pdp_view", productId: f.products["skull-charm"], ts },
    ]);
    const d = await getInsights(db(), { from: "2026-11-01", to: "2026-11-01" });
    expect(d.searchesNoResults.map((s) => [s.term, s.searches])).toEqual([["dragon", 2], ["unicorn", 1]]);
    expect(d.topSearches[0]).toMatchObject({ term: "dragon", searches: 2 });
    expect(d.topSearches.map((s) => s.term)).toContain("charm");
    expect(d.heroTiles).toEqual([
      { tile: "3", vibe: "cute", clicks: 2 },
      { tile: "1", vibe: "gothic", clicks: 1 },
    ]);
    expect(d.totals.heroTileClicks).toBe(3);
    // events but no rollup rows yet
    expect(d.rollupPending).toBe(true);
  });
});

describe("CSV exports of real data", () => {
  it("renders every report as spreadsheet-safe CSV", async () => {
    await seedSales();
    const sales = salesCsv(await getSalesReport(db(), RANGE, "day"));
    expect(sales.split("\r\n")[0]).toBe("Day,Orders,Revenue (INR),Discounts (INR),Average order value (INR)");
    expect(sales.split("\r\n")).toHaveLength(5 + 2); // header + 5 days + trailing newline
    expect(sales).toContain("2026-11-02,0,0.00,0.00,");
    expect(statusCsv(await getOrdersByStatus(db(), RANGE))).toContain("Order status,confirmed,4,");
    expect(topCsv("Product", await getTopProducts(db(), RANGE))).toContain("Skull Charm,2,3,597.00");
    expect(couponsCsv(await getCouponPerformance(db(), RANGE))).toBe(
      "Code,Orders,Discount given (INR),Items value (INR),Order totals (INR),Discount rate (%)\r\n",
    );
    expect(funnelCsv(await getFunnel(db(), RANGE)).split("\r\n")[0]).toBe(
      "Stage,Sessions,Of all sessions (%),Of previous stage (%),Dropped since previous",
    );
  });
});
