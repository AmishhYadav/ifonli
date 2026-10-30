import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/server/db";
import {
  carts,
  invoices,
  orders,
  rateLimits,
  stockReservations,
  variants,
  webhookEvents,
} from "@/server/db/schema";
import { cleanupHousekeeping } from "@/server/payments/cleanup";
import { MockPaymentProvider } from "@/server/payments/mock";
import { reconcileAll, reconcilePayments, releaseDueReservations } from "@/server/payments/reconcile";
import { setPaymentProvider } from "@/server/payments/registry";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, makeCart, placePrepaidOrder, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
let f: Fixture;
let provider: MockPaymentProvider;

beforeEach(async () => {
  provider = new MockPaymentProvider({ deterministic: true });
  setPaymentProvider(provider);
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});
afterEach(() => setPaymentProvider(null));

const stockOf = async (id: string) =>
  (await db().select({ n: variants.stockOnHand }).from(variants).where(eq(variants.id, id)))[0]!.n;
const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

describe("reconcile-payments", () => {
  it("finalizes an order that was captured at the provider but never verified (lost callbacks)", async () => {
    // placed 20 minutes ago: older than 5 minutes, reservation (15 min) already lapsed by the clock
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }], { now: minutesAgo(20) });
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);

    const stats = await reconcilePayments(db(), provider);
    expect(stats).toMatchObject({ checked: 1, finalized: 1, expired: 0, errors: 0 });
    expect(stats.productIds).toHaveLength(1);
    expect(await orderRow(placed.order.orderId)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    expect(await stockOf(f.variants.skull!)).toBe(8);
    expect(await db().select().from(invoices)).toHaveLength(1);

    // a second run changes nothing
    expect(await reconcilePayments(db(), provider)).toMatchObject({ checked: 0, finalized: 0 });
    expect(paid.id).toBeTruthy();
  });

  it("captures an authorized payment it finds", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }], { now: minutesAgo(8) });
    provider.simulatePayment(placed.payment.razorpayOrderId, { status: "authorized" });
    expect(await reconcilePayments(db(), provider)).toMatchObject({ finalized: 1 });
    expect(provider.calls.some((c) => c.startsWith("capture:"))).toBe(true);
  });

  it("expires an abandoned order whose reservation lapsed and releases its stock", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }], { now: minutesAgo(20) });
    const stats = await reconcilePayments(db(), provider);
    expect(stats).toMatchObject({ checked: 1, finalized: 0, expired: 1, errors: 0 });
    expect(await orderRow(placed.order.orderId)).toMatchObject({ status: "expired", paymentStatus: "unpaid" });
    const res = await db().select().from(stockReservations).where(eq(stockReservations.orderId, placed.order.orderId));
    expect(res.every((r) => r.status === "released")).toBe(true);
    expect(await stockOf(f.variants.skull!)).toBe(10);
  });

  it("leaves younger orders and still-valid reservations alone", async () => {
    const fresh = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const waiting = await placePrepaidOrder(provider, [{ variantId: f.variants.ghost!, qty: 1 }], { now: minutesAgo(7) });
    const stats = await reconcilePayments(db(), provider);
    expect(stats).toMatchObject({ checked: 1, finalized: 0, expired: 0 });
    expect((await orderRow(fresh.order.orderId)).status).toBe("pending_payment");
    expect((await orderRow(waiting.order.orderId)).status).toBe("pending_payment");
  });

  it("never expires an order it could not check (provider outage)", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }], { now: minutesAgo(20) });
    provider.simulatePayment(placed.payment.razorpayOrderId);
    provider.failNext("fetchOrderPayments");
    const stats = await reconcilePayments(db(), provider);
    expect(stats).toMatchObject({ errors: 1, expired: 0, finalized: 0 });
    expect((await orderRow(placed.order.orderId)).status).toBe("pending_payment");
    expect(await reconcilePayments(db(), provider)).toMatchObject({ finalized: 1 });
  });

  it("picks up a late capture of a recently expired order", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }], { now: minutesAgo(20) });
    await reconcilePayments(db(), provider); // expires it
    expect((await orderRow(placed.order.orderId)).status).toBe("expired");
    provider.simulatePayment(placed.payment.razorpayOrderId);
    expect(await reconcilePayments(db(), provider)).toMatchObject({ finalized: 1 });
    expect(await orderRow(placed.order.orderId)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
  });

  it("reconcileAll also runs the refund sweeper", async () => {
    const r = await reconcileAll(db(), provider);
    expect(r.refunds).toEqual({ sent: 0, polled: 0, errors: 0 });
  });
});

describe("release-reservations", () => {
  it("finalizes a paid order instead of expiring it, expires the unpaid one, then sweeps", async () => {
    const paidOne = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }], { now: minutesAgo(20) });
    const lapsed = await placePrepaidOrder(provider, [{ variantId: f.variants.ghost!, qty: 1 }], { now: minutesAgo(20) });
    provider.simulatePayment(paidOne.payment.razorpayOrderId);

    const stats = await releaseDueReservations(db(), provider);
    expect(stats).toMatchObject({ finalized: 1, expired: 1, errors: 0 });
    expect((await orderRow(paidOne.order.orderId)).status).toBe("confirmed");
    expect((await orderRow(lapsed.order.orderId)).status).toBe("expired");
  });

  it("skips the blanket sweep when the provider could not be asked", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }], { now: minutesAgo(20) });
    provider.failNext("fetchOrderPayments");
    const stats = await releaseDueReservations(db(), provider);
    expect(stats).toMatchObject({ errors: 1, expired: 0, swept: 0 });
    expect((await orderRow(placed.order.orderId)).status).toBe("pending_payment");
  });
});

describe("cleanup", () => {
  it("deletes expired carts, old processed webhook events and stale rate-limit windows", async () => {
    const stale = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    await db().update(carts).set({ expiresAt: minutesAgo(10) }).where(eq(carts.id, stale.id));
    const live = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);

    const old = new Date(Date.now() - 100 * 86_400_000);
    await db().insert(webhookEvents).values([
      { providerEventId: "old-done", type: "x", payload: {}, processedAt: old },
      { providerEventId: "old-unprocessed", type: "x", payload: {} },
      { providerEventId: "recent", type: "x", payload: {}, processedAt: new Date() },
    ]);
    await db().insert(rateLimits).values({ key: "k", windowStart: new Date(Date.now() - 3 * 86_400_000), count: 1 });

    expect(await cleanupHousekeeping(db())).toEqual({ cartsDeleted: 1, webhookEventsDeleted: 1, rateLimitWindowsDeleted: 1 });
    expect((await db().select({ id: carts.id }).from(carts)).map((c) => c.id)).toEqual([live.id]);
    expect((await db().select().from(webhookEvents)).map((w) => w.providerEventId).sort()).toEqual(["old-unprocessed", "recent"]);
  });
});

describe("cron routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("CRON_SECRET", "s3cret-for-tests");
  });
  afterEach(() => vi.unstubAllEnvs());

  const loaders = {
    "reconcile-payments": () => import("@/app/api/cron/reconcile-payments/route"),
    "release-reservations": () => import("@/app/api/cron/release-reservations/route"),
    cleanup: () => import("@/app/api/cron/cleanup/route"),
  } as const;
  const routes = Object.keys(loaders) as (keyof typeof loaders)[];

  it.each(routes)("%s rejects a missing or wrong bearer and runs with the right one", async (name) => {
    const { GET } = await loaders[name]();
    const call = (headers: Record<string, string>) => GET(new Request(`http://localhost/api/cron/${name}`, { headers }));
    expect((await call({})).status).toBe(401);
    expect((await call({ authorization: "Bearer nope" })).status).toBe(401);
    expect((await call({ authorization: "s3cret-for-tests" })).status).toBe(401);
    expect((await call({ authorization: "Bearer s3cret-for-tests-and-more" })).status).toBe(401);
    const ok = await call({ authorization: "Bearer s3cret-for-tests" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
  });
});
