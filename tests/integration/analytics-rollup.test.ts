import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("CRON_SECRET", "analytics-test-secret");

import { GET as cronRollup } from "@/app/api/cron/analytics-rollup/route";
import { getDb } from "@/server/db";
import { analyticsEvents, productEngagementDaily, products } from "@/server/db/schema";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import { rollupDay, runAnalyticsRollup } from "@/server/services/analytics/rollup";
import { createFromCart } from "@/server/services/orders";
import { finalizePaidOrder } from "@/server/services/payments";
import { setSetting } from "@/server/services/settings";
import { initiateOrderPayment } from "@/server/payments/initiate";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import {
  checkoutForm,
  configureCommerce,
  makeCart,
  placePaidOrder,
  placePrepaidOrder,
  seedCommerceReference,
} from "./helpers/factories";

const db = () => getDb();
let f: Fixture;
let provider: MockPaymentProvider;

const SID = "feedfacefeedfacefeedfacefeedface";

beforeEach(async () => {
  provider = new MockPaymentProvider({ deterministic: true });
  setPaymentProvider(provider);
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});
afterEach(() => setPaymentProvider(null));

const eventsOf = (name: string) => db().select().from(analyticsEvents).where(eq(analyticsEvents.event, name));

async function placeCod(items: { variantId: string; qty: number }[], analyticsSessionId?: string) {
  const cart = await makeCart(items);
  const r = await createFromCart(db(), {
    cartToken: cart.token,
    form: checkoutForm({ paymentMethod: "cod" }),
    analyticsSessionId,
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.order;
}

describe("server-side purchase events", () => {
  it("records a COD sale at placement: one order row and one row per product, tied to the visit", async () => {
    const order = await placeCod(
      [
        { variantId: f.variants.skull!, qty: 2 },
        { variantId: f.variants.spiky ?? f.variants["spiky"]!, qty: 1 },
      ],
      SID,
    );
    const [purchase] = await eventsOf("purchase");
    expect(purchase).toMatchObject({ sessionId: SID, productId: null, value: order.totalPaise });
    expect(purchase!.meta).toMatchObject({ orderId: order.orderId, method: "cod", items: 3 });

    const items = await eventsOf("purchase_item");
    expect(items).toHaveLength(2);
    const skull = items.find((i) => i.productId === f.products["skull-charm"])!;
    expect(skull.sessionId).toBe(SID);
    expect(skull.meta).toMatchObject({ orderId: order.orderId, qty: 2 });
    expect(skull.value).toBe(2 * 19900); // no discount in this order
    expect(await eventsOf("order_placed")).toHaveLength(1);
  });

  it("records an order with no known visit under a private order key (no funnel join)", async () => {
    const order = await placeCod([{ variantId: f.variants.skull!, qty: 1 }]);
    const [purchase] = await eventsOf("purchase");
    expect(purchase!.sessionId).toBe(`order:${order.orderId}`);
    expect(await eventsOf("order_placed")).toHaveLength(0);
  });

  it("does not record a prepaid order until the payment is captured, then records it once", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const r = await createFromCart(db(), {
      cartToken: cart.token,
      form: checkoutForm(),
      analyticsSessionId: SID,
      initiatePayment: (ctx) => initiateOrderPayment(ctx, { provider }),
    });
    if (!r.ok || !r.payment) throw new Error("placement failed");
    expect(await eventsOf("purchase")).toHaveLength(0);
    expect(await eventsOf("order_placed")).toHaveLength(1);

    const paid = provider.simulatePayment(r.payment.razorpayOrderId);
    const captured = { providerOrderId: paid.orderId!, providerPaymentId: paid.id, amountPaise: paid.amountPaise, method: paid.method };
    await finalizePaidOrder(db(), r.order.orderId, captured, { provider });
    const [purchase] = await eventsOf("purchase");
    expect(purchase).toMatchObject({ sessionId: SID, value: r.order.totalPaise });
    expect(purchase!.meta).toMatchObject({ method: "razorpay" });
    expect(await eventsOf("purchase_item")).toHaveLength(1);

    // replaying the same capture (webhook + verify + reconcile) must not double count
    await finalizePaidOrder(db(), r.order.orderId, captured, { provider });
    expect(await eventsOf("purchase")).toHaveLength(1);
    expect(await eventsOf("purchase_item")).toHaveLength(1);
  });

  it("falls back to the private key for a paid order placed without a visit id", async () => {
    const { order } = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const [purchase] = await eventsOf("purchase");
    expect(purchase!.sessionId).toBe(`order:${order.orderId}`);
  });

  it("an unpaid prepaid order is not a purchase", async () => {
    await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    expect(await eventsOf("purchase")).toHaveLength(0);
  });
});

// Rollup: events at known instants. 1 Nov 2026 IST runs from 2026-10-31T18:30Z to 2026-11-01T18:30Z.
const DAY = "2026-11-01";
const inDay = (hhmmUtc: string) => new Date(`2026-11-01T${hhmmUtc}:00Z`);

async function ev(
  event: string,
  over: { sessionId?: string; productId?: string | null; value?: number; ts?: Date; meta?: Record<string, unknown> } = {},
) {
  await db()
    .insert(analyticsEvents)
    .values({
      sessionId: over.sessionId ?? "sessionaaaaaaaaaaaaaaaaaaaaaaaa",
      event,
      productId: over.productId ?? null,
      value: over.value ?? null,
      meta: over.meta ?? null,
      ts: over.ts ?? inDay("06:00"),
    });
}

const rollupRows = () => db().select().from(productEngagementDaily);
/** Rollup rows without ids and timestamps, in a stable order. */
const stable = async () =>
  (await rollupRows())
    .map((r) => [r.date, r.productId, r.impressions, r.clicks, r.pdpViews, r.uniqueViewers, r.avgScrollDepth, r.reached75Pct, r.addToCarts, r.purchases, r.revenuePaise].join("|"))
    .sort();

describe("rollupDay", () => {
  it("aggregates counts, unique viewers, scroll depth, purchases and revenue per product", async () => {
    const skull = f.products["skull-charm"]!;
    const heart = f.products["heart-charm"]!;
    const a = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const b = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    for (let i = 0; i < 5; i++) await ev("product_impression", { productId: skull, sessionId: i % 2 ? a : b });
    await ev("product_impression", { productId: heart });
    await ev("product_click", { productId: skull, sessionId: a });
    await ev("product_click", { productId: skull, sessionId: b });
    await ev("pdp_view", { productId: skull, sessionId: a });
    await ev("pdp_view", { productId: skull, sessionId: a }); // same visitor again
    await ev("pdp_view", { productId: skull, sessionId: b });
    // a reached 25, 50, 75; b reached only 25
    for (const m of [25, 50, 75]) await ev("pdp_scroll_depth", { productId: skull, sessionId: a, value: m });
    await ev("pdp_scroll_depth", { productId: skull, sessionId: b, value: 25 });
    await ev("add_to_cart", { productId: skull, sessionId: a, value: 2 });
    await ev("purchase_item", { productId: skull, sessionId: a, value: 39800, meta: { orderId: "o1", qty: 2 } });
    await ev("purchase_item", { productId: skull, sessionId: b, value: 19900, meta: { orderId: "o2", qty: 1 } });
    // not rolled up: wishlist, and events with no product
    await ev("wishlist_add", { productId: heart });
    await ev("page_view");

    const written = await rollupDay(db(), DAY);
    expect(written).toBe(2);
    const rows = await rollupRows();
    const s = rows.find((r) => r.productId === skull)!;
    expect(s).toMatchObject({
      date: DAY,
      impressions: 5,
      clicks: 2,
      pdpViews: 3,
      uniqueViewers: 2,
      reached75Pct: 1,
      addToCarts: 1,
      purchases: 2,
      revenuePaise: 59700,
    });
    expect(s.avgScrollDepth).toBeCloseTo((75 + 25) / 2);
    expect(rows.find((r) => r.productId === heart)).toMatchObject({ impressions: 1, clicks: 0, pdpViews: 0, purchases: 0 });
  });

  it("buckets by India day: 00:30 IST belongs to the new day, 23:59 IST to the old one", async () => {
    const skull = f.products["skull-charm"]!;
    await ev("pdp_view", { productId: skull, ts: new Date("2026-10-31T18:29:59Z") }); // 31 Oct 23:59:59 IST
    await ev("pdp_view", { productId: skull, ts: new Date("2026-10-31T18:30:00Z") }); // 1 Nov 00:00:00 IST
    await ev("pdp_view", { productId: skull, ts: new Date("2026-11-01T18:29:59Z") }); // 1 Nov 23:59:59 IST
    await ev("pdp_view", { productId: skull, ts: new Date("2026-11-01T18:30:00Z") }); // 2 Nov 00:00 IST
    await rollupDay(db(), "2026-10-31");
    await rollupDay(db(), "2026-11-01");
    await rollupDay(db(), "2026-11-02");
    const byDate = Object.fromEntries((await rollupRows()).map((r) => [r.date, r.pdpViews]));
    expect(byDate).toEqual({ "2026-10-31": 1, "2026-11-01": 2, "2026-11-02": 1 });
  });

  it("is idempotent, and a re-run picks up late events and drops nothing else", async () => {
    const skull = f.products["skull-charm"]!;
    await ev("product_impression", { productId: skull });
    await rollupDay(db(), DAY);
    await rollupDay(db(), DAY);
    const first = await rollupRows();
    expect(first).toHaveLength(1);
    expect(first[0]!.impressions).toBe(1);

    await ev("product_impression", { productId: skull });
    await rollupDay(db(), DAY);
    await Promise.all([rollupDay(db(), DAY), rollupDay(db(), DAY)]); // overlapping runs
    const again = await rollupRows();
    expect(again).toHaveLength(1);
    expect(again[0]!.impressions).toBe(2);
  });

  it("leaves other days alone and skips products that no longer exist", async () => {
    const skull = f.products["skull-charm"]!;
    await ev("pdp_view", { productId: skull });
    await ev("pdp_view", { productId: "00000000-0000-4000-8000-000000000000" }); // deleted / unknown product
    await ev("pdp_view", { productId: skull, ts: new Date("2026-10-20T06:00:00Z") });
    await rollupDay(db(), "2026-10-20");
    await rollupDay(db(), DAY);
    const rows = await rollupRows();
    expect(rows.map((r) => [r.date, r.productId, r.pdpViews]).sort()).toEqual(
      [
        ["2026-10-20", skull, 1],
        [DAY, skull, 1],
      ].sort(),
    );
    // rebuilding one day does not touch the other
    await rollupDay(db(), DAY);
    expect(await rollupRows()).toHaveLength(2);
  });

  it("removes a day's rows when its events are gone (rebuild from scratch)", async () => {
    const skull = f.products["skull-charm"]!;
    await ev("pdp_view", { productId: skull });
    await rollupDay(db(), DAY);
    await db().delete(analyticsEvents);
    await rollupDay(db(), DAY);
    expect(await rollupRows()).toHaveLength(0);
  });
});

describe("runAnalyticsRollup and retention", () => {
  const now = new Date("2026-11-01T06:00:00Z"); // 11:30 IST on 1 Nov

  it("rebuilds the last three India days and reports what it did", async () => {
    const skull = f.products["skull-charm"]!;
    await ev("pdp_view", { productId: skull, ts: new Date("2026-10-30T06:00:00Z") });
    await ev("pdp_view", { productId: skull, ts: new Date("2026-11-01T05:00:00Z") });
    const out = await runAnalyticsRollup(db(), { now });
    expect(out.days.map((d) => d.day)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(out.days.map((d) => d.rows)).toEqual([1, 0, 1]);
    expect(out.retentionMonths).toBe(13);
    expect((await rollupRows()).map((r) => r.date).sort()).toEqual(["2026-10-30", "2026-11-01"]);
  });

  it("deletes raw events older than the retention setting but keeps the rollup", async () => {
    const skull = f.products["skull-charm"]!;
    await setSetting("event_retention_months", 2, null);
    await ev("pdp_view", { productId: skull, ts: new Date("2026-08-15T06:00:00Z") }); // older than 2 months
    await ev("pdp_view", { productId: skull, ts: new Date("2026-09-15T06:00:00Z") }); // inside
    await ev("page_view", { ts: new Date("2026-01-01T06:00:00Z") });
    await db().insert(productEngagementDaily).values({ date: "2026-08-15", productId: skull, pdpViews: 9 });

    const out = await runAnalyticsRollup(db(), { now, days: 90 });
    expect(out.retentionMonths).toBe(2);
    expect(out.eventsDeleted).toBe(2);
    const left = await db().select().from(analyticsEvents);
    expect(left.map((e) => e.ts.toISOString())).toEqual(["2026-09-15T06:00:00.000Z"]);
    const old = await db().select().from(productEngagementDaily).where(and(eq(productEngagementDaily.date, "2026-08-15")));
    expect(old).toHaveLength(1); // not rebuilt from the deleted events
    expect(old[0]!.pdpViews).toBe(9);
    // the September day was rebuilt from its surviving event
    const sep = await db().select().from(productEngagementDaily).where(eq(productEngagementDaily.date, "2026-09-15"));
    expect(sep[0]!.pdpViews).toBe(1);
  });

  it("a second run changes nothing", async () => {
    const skull = f.products["skull-charm"]!;
    await ev("pdp_view", { productId: skull });
    await runAnalyticsRollup(db(), { now });
    const before = await stable();
    const out = await runAnalyticsRollup(db(), { now });
    expect(out.eventsDeleted).toBe(0);
    expect(await stable()).toEqual(before);
  });

  it("rollup rows go away with their product (cascade) and other products keep theirs", async () => {
    const skull = f.products["skull-charm"]!;
    const cat = f.products["cat-sticker"]!;
    await ev("pdp_view", { productId: skull });
    await ev("pdp_view", { productId: cat });
    await rollupDay(db(), DAY);
    expect(await rollupRows()).toHaveLength(2);
    await db().delete(products).where(eq(products.id, cat));
    expect((await rollupRows()).map((r) => r.productId)).toEqual([skull]);
  });
});

describe("GET /api/cron/analytics-rollup", () => {
  const call = (headers: Record<string, string> = {}, qs = "") =>
    cronRollup(new Request(`https://ifonli.test/api/cron/analytics-rollup${qs}`, { headers }));

  it("rejects requests without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("runs with the secret and honours ?days", async () => {
    const res = await call({ authorization: "Bearer analytics-test-secret" }, "?days=5");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; days: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.days).toHaveLength(5);
  });
});
