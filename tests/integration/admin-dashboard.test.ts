import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { orderEvents, orders, payments, refunds, supportCases, user, variants } from "@/server/db/schema";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import { getDashboardStats } from "@/server/services/admin/dashboard";
import { addShipment, cancelOrder } from "@/server/services/admin/orders";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, placeCodOrder, placePaidOrder, placePrepaidOrder, seedCommerceReference } from "./helpers/factories";

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

describe("admin dashboard", () => {
  it("is empty and zeroed on a fresh store", async () => {
    const s = await getDashboardStats(db(), { withActivity: true });
    expect(s.sales.today).toEqual({ orders: 0, revenuePaise: 0 });
    expect(s.sales.aovPaise).toBeNull();
    expect(s.awaitingFulfilment.total).toBe(0);
    expect(s.openSupportCases).toBe(0);
    expect(s.anomalies).toMatchObject({ duplicateOrLate: 0, pendingRefunds: 0, failedRefunds: 0 });
    expect(s.recentOrders).toEqual([]);
  });

  it("counts paid + COD placed orders, excludes cancelled / pending, computes AOV and windows", async () => {
    // paid online: 2 x 199 + 50 shipping = 448.00
    const paid = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
    // COD: 1 x 199 + 50 + 40 fee = 289.00
    const cod = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
    // pending payment: not a sale
    await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    // cancelled COD: not a sale
    const gone = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
    await cancelOrder(db(), gone.order.orderId, { reason: "test cancel" }, owner, provider);
    // an old order outside the 7-day window
    const old = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
    await db().update(orders).set({ placedAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(orders.id, old.order.orderId));
    // placed 3 days ago: in the week, not today
    const mid = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
    await db().update(orders).set({ placedAt: new Date(Date.now() - 3 * 86_400_000) }).where(eq(orders.id, mid.order.orderId));

    const s = await getDashboardStats(db(), { withActivity: false });
    expect(s.sales.today).toEqual({ orders: 2, revenuePaise: paid.order.totalPaise + cod.order.totalPaise });
    expect(s.sales.week).toEqual({ orders: 3, revenuePaise: paid.order.totalPaise + cod.order.totalPaise + mid.order.totalPaise });
    expect(s.sales.aovPaise).toBe(Math.round(s.sales.week.revenuePaise / 3));
    // awaiting fulfilment: paid, cod, old, mid (cancelled and pending excluded)
    expect(s.awaitingFulfilment).toEqual({ total: 4, unfulfilled: 4, packed: 0 });
    await addShipment(db(), paid.order.orderId, { courier: "Delhivery" }, owner);
    expect((await getDashboardStats(db(), { withActivity: false })).awaitingFulfilment.total).toBe(3);
    expect(s.recentOrders.map((o) => o.ref)).not.toContain(undefined);
    expect(s.recentOrders.length).toBeGreaterThanOrEqual(4);
    expect(s.recentActivity).toEqual([]);
  });

  it("counts low / out of stock variants and open support cases", async () => {
    await db().update(variants).set({ stockOnHand: 0 }).where(eq(variants.id, f.variants.skull!));
    const base = await getDashboardStats(db(), { withActivity: false });
    expect(base.outOfStock).toBeGreaterThanOrEqual(1);
    expect(base.lowStock).toBeGreaterThanOrEqual(1); // cat sticker (3 left) is low

    const { order } = await placeCodOrder([{ variantId: f.variants.ghost ?? Object.values(f.variants)[3]!, qty: 1 }]);
    await db().insert(supportCases).values([
      { orderId: order.orderId, type: "damaged", description: "broken" },
      { orderId: order.orderId, type: "missing", description: "gone", status: "in_progress" },
      { orderId: order.orderId, type: "other", description: "done", status: "resolved" },
    ]);
    expect((await getDashboardStats(db(), { withActivity: false })).openSupportCases).toBe(2);
  });

  it("flags payment anomalies: failed / stuck refunds, duplicate payments, late confirmations", async () => {
    const { order } = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const [pay] = await db().select().from(payments).where(eq(payments.orderId, order.orderId));
    await db().insert(refunds).values([
      { orderId: order.orderId, paymentId: pay!.id, amountPaise: 1000, status: "failed", reason: "x" },
      { orderId: order.orderId, paymentId: pay!.id, amountPaise: 2000, status: "pending", reason: "fresh" },
    ]);
    await db().insert(payments).values({
      orderId: order.orderId,
      providerOrderId: "order_dup#dup:pay_dup",
      providerPaymentId: "pay_dup",
      amountPaise: 29900,
      status: "captured",
      raw: { disposition: "duplicate" },
    });
    await db().insert(orderEvents).values({ orderId: order.orderId, type: "late_payment_confirmed" });

    let s = await getDashboardStats(db(), { withActivity: false });
    // a fresh pending refund is not stuck yet
    expect(s.anomalies).toMatchObject({ failedRefunds: 1, pendingRefunds: 0, duplicateOrLate: 1, lateConfirmed7d: 1 });
    expect(s.anomalies.items.map((i) => i.kind).sort()).toEqual(["duplicate_payment", "refund_failed"]);

    // once the pending refund is 45 minutes old it counts as stuck
    s = await getDashboardStats(db(), { withActivity: false, now: new Date(Date.now() + 45 * 60_000) });
    expect(s.anomalies.pendingRefunds).toBe(1);
    // the duplicate stops being an anomaly once its refund is processed
    const [dup] = await db().select().from(payments).where(eq(payments.providerPaymentId, "pay_dup"));
    await db().insert(refunds).values({ orderId: order.orderId, paymentId: dup!.id, amountPaise: 29900, status: "processed" });
    s = await getDashboardStats(db(), { withActivity: false });
    expect(s.anomalies.duplicateOrLate).toBe(0);
  });
});
