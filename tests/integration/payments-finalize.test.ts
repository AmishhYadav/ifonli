import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import {
  couponRedemptions,
  inventoryMovements,
  invoices,
  notificationOutbox,
  orders,
  payments,
  refunds,
  stockReservations,
  variants,
} from "@/server/db/schema";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import { adjustStock } from "@/server/services/inventory";
import { expireOrder } from "@/server/services/orders";
import { finalizePaidOrder, nextInvoiceNumber, type CapturedPayment } from "@/server/services/payments";
import { retryPendingRefunds } from "@/server/services/refunds";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, makeCoupon, placePrepaidOrder, seedCommerceReference } from "./helpers/factories";

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
const captured = (p: { orderId: string | null; id: string; amountPaise: number; method: string | null }): CapturedPayment => ({
  providerOrderId: p.orderId!,
  providerPaymentId: p.id,
  amountPaise: p.amountPaise,
  method: p.method,
});
const fin = (orderId: string, p: Parameters<typeof captured>[0]) =>
  finalizePaidOrder(db(), orderId, captured(p), { provider });
const outboxBy = async (template: string) =>
  db().select().from(notificationOutbox).where(eq(notificationOutbox.template, template));

describe("duplicate payments", () => {
  it("refunds a second payment on an already-paid order in full, flags it and alerts the admin", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const p1 = provider.simulatePayment(placed.payment.razorpayOrderId);
    const p2 = provider.simulatePayment(placed.payment.razorpayOrderId);
    expect((await fin(placed.order.orderId, p1)).outcome).toBe("finalized");
    const r = await fin(placed.order.orderId, p2);
    expect(r).toMatchObject({ outcome: "refunded", reason: "duplicate" });

    // The order is untouched by the duplicate: one sale, one invoice, still paid by p1.
    expect(await stockOf(f.variants.skull!)).toBe(9);
    expect(await db().select().from(invoices)).toHaveLength(1);
    expect(await orderRow(placed.order.orderId)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });

    const rows = await db().select().from(payments).orderBy(payments.createdAt);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ providerPaymentId: p1.id, status: "captured" });
    expect(rows[1]).toMatchObject({ providerPaymentId: p2.id, status: "captured" });
    expect(rows[1]!.raw).toMatchObject({ disposition: "duplicate" });

    const [refund] = await db().select().from(refunds);
    expect(refund).toMatchObject({ paymentId: rows[1]!.id, amountPaise: p2.amountPaise, status: "processed" });
    expect(refund!.providerRefundId).toMatch(/^rfnd_mock_/);
    expect(provider.calls.filter((c) => c.startsWith("refund:"))).toEqual([`refund:${p2.id}:${p2.amountPaise}`]);

    const alerts = await outboxBy("payment_anomaly");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({ kind: "duplicate", providerPaymentId: p2.id });
    expect(await outboxBy("refund_initiated")).toHaveLength(1);
  });

  it("is idempotent for the duplicate too: replaying it neither double-refunds nor double-alerts", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const p1 = provider.simulatePayment(placed.payment.razorpayOrderId);
    const p2 = provider.simulatePayment(placed.payment.razorpayOrderId);
    await fin(placed.order.orderId, p1);
    await Promise.all([fin(placed.order.orderId, p2), fin(placed.order.orderId, p2), fin(placed.order.orderId, p2)]);
    expect(await db().select().from(refunds)).toHaveLength(1);
    expect(provider.calls.filter((c) => c.startsWith("refund:"))).toHaveLength(1);
    expect(await outboxBy("payment_anomaly")).toHaveLength(1);
  });

  it("handles a duplicate made against a second provider order of the same order", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const second = await provider.createOrder({ amountPaise: placed.order.totalPaise, receipt: placed.order.ref, notes: {} });
    await db().insert(payments).values({
      orderId: placed.order.orderId,
      providerOrderId: second.id,
      amountPaise: placed.order.totalPaise,
      status: "created",
    });
    const p1 = provider.simulatePayment(placed.payment.razorpayOrderId);
    const p2 = provider.simulatePayment(second.id);
    await fin(placed.order.orderId, p1);
    await fin(placed.order.orderId, p2);
    const rows = await db().select().from(payments).where(eq(payments.providerOrderId, second.id));
    expect(rows[0]).toMatchObject({ providerPaymentId: p2.id, status: "captured" });
    expect((await db().select().from(refunds))[0]).toMatchObject({ paymentId: rows[0]!.id, status: "processed" });
    expect(await stockOf(f.variants.skull!)).toBe(9);
  });

  it("keeps the refund pending when the provider is down and sends it from the retry sweep", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const p1 = provider.simulatePayment(placed.payment.razorpayOrderId);
    const p2 = provider.simulatePayment(placed.payment.razorpayOrderId);
    await fin(placed.order.orderId, p1);
    provider.failNext("listRefunds");
    await fin(placed.order.orderId, p2);
    expect((await db().select().from(refunds))[0]).toMatchObject({ status: "pending", providerRefundId: null });

    // too fresh for the sweeper
    expect(await retryPendingRefunds(db(), provider, { now: new Date() })).toMatchObject({ sent: 0 });
    const stats = await retryPendingRefunds(db(), provider, { now: new Date(Date.now() + 5 * 60_000) });
    expect(stats.sent).toBe(1);
    expect((await db().select().from(refunds))[0]).toMatchObject({ status: "processed" });
    expect(provider.refunds.size).toBe(1);
  });

  it("does not issue a second refund if the first reached the provider but our write was lost", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const p1 = provider.simulatePayment(placed.payment.razorpayOrderId);
    const p2 = provider.simulatePayment(placed.payment.razorpayOrderId);
    await fin(placed.order.orderId, p1);
    provider.failNext("listRefunds");
    await fin(placed.order.orderId, p2); // refund row saved, provider call skipped
    const [row] = await db().select().from(refunds);
    // The refund went out (e.g. the process died before recording it)...
    await provider.refund(p2.id, { amountPaise: p2.amountPaise, receipt: row!.id, notes: { refund_id: row!.id } });
    // ...the sweeper recognises it by its note instead of refunding again.
    await retryPendingRefunds(db(), provider, { now: new Date(Date.now() + 5 * 60_000) });
    expect(provider.refunds.size).toBe(1);
    expect((await db().select().from(refunds))[0]!.providerRefundId).toBe([...provider.refunds.keys()][0]);
  });
});

describe("late capture after expiry", () => {
  it("re-confirms the order when stock is still available (expired -> confirmed)", async () => {
    const coupon = await makeCoupon({ code: "LATE10" });
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }], { couponCode: "LATE10" });
    await expireOrder(db(), placed.order.orderId);
    expect((await orderRow(placed.order.orderId)).status).toBe("expired");
    expect((await db().select().from(couponRedemptions))[0]!.status).toBe("released");

    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    const r = await fin(placed.order.orderId, paid);
    expect(r).toMatchObject({ outcome: "finalized", late: true });
    expect(await orderRow(placed.order.orderId)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    expect(await stockOf(f.variants.skull!)).toBe(8);
    expect((await db().select().from(couponRedemptions).where(eq(couponRedemptions.couponId, coupon.id)))[0]!.status).toBe("confirmed");
    expect(await db().select().from(invoices)).toHaveLength(1);
    expect(await db().select().from(refunds)).toHaveLength(0);
  });

  it("refunds in full, apologises and alerts when the stock is gone", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.cat!, qty: 3 }]); // all 3 units
    await expireOrder(db(), placed.order.orderId);
    await adjustStock({ variantId: f.variants.cat!, delta: -3, reason: "sale", actorId: null }); // someone else bought them
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);

    const r = await fin(placed.order.orderId, paid);
    expect(r).toMatchObject({ outcome: "refunded", reason: "no_stock" });
    expect(await stockOf(f.variants.cat!)).toBe(0);
    const o = await orderRow(placed.order.orderId);
    expect(o).toMatchObject({ status: "expired", paymentStatus: "refunded", paidAt: null });
    expect((await db().select().from(refunds))[0]).toMatchObject({ amountPaise: paid.amountPaise, status: "processed" });
    expect(await db().select().from(invoices)).toHaveLength(0);
    expect(await outboxBy("payment_late_refund")).toHaveLength(1);
    expect((await outboxBy("payment_anomaly"))[0]!.payload).toMatchObject({ kind: "no_stock" });
    expect(await outboxBy("order_confirmed")).toHaveLength(0);
    // replay stays a single refund
    await fin(placed.order.orderId, paid);
    expect(provider.refunds.size).toBe(1);
  });

  it("counts the order's own live reservation as available to it", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.cat!, qty: 3 }]);
    expect((await db().select().from(stockReservations))[0]!.status).toBe("active");
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    expect((await fin(placed.order.orderId, paid)).outcome).toBe("finalized");
    expect(await stockOf(f.variants.cat!)).toBe(0);
  });
});

describe("invoice numbers", () => {
  it("are sequential and unique under concurrent finalisation", async () => {
    const placed = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        placePrepaidOrder(provider, [{ variantId: f.variants.ghost!, qty: 1 }], { form: { email: `buyer${i}@example.com` } }),
      ),
    );
    const paid = placed.map((p) => provider.simulatePayment(p.payment.razorpayOrderId));
    await Promise.all(placed.map((p, i) => fin(p.order.orderId, paid[i]!)));

    const numbers = (await db().select({ n: invoices.number }).from(invoices)).map((r) => r.n).sort();
    expect(new Set(numbers).size).toBe(6);
    const seqs = numbers.map((n) => Number(n.split("/")[2])).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await stockOf(f.variants.ghost!)).toBe(14);
  });

  it("restarts at 1 in a new financial year, with the FY in the number", async () => {
    const mar = new Date("2027-03-31T10:00:00Z"); // 31 Mar IST: FY 26-27
    const apr = new Date("2027-03-31T19:00:00Z"); // 1 Apr 00:30 IST: FY 27-28
    const a = await db().transaction((tx) => nextInvoiceNumber(tx, mar));
    const b = await db().transaction((tx) => nextInvoiceNumber(tx, mar));
    const c = await db().transaction((tx) => nextInvoiceNumber(tx, apr));
    expect([a, b, c]).toEqual(["IFO/26-27/000001", "IFO/26-27/000002", "IFO/27-28/000001"]);
  });

  it("gives the number back when the transaction rolls back (gapless)", async () => {
    const now = new Date("2026-11-02T04:30:00Z");
    await db()
      .transaction(async (tx) => {
        expect(await nextInvoiceNumber(tx, now)).toBe("IFO/26-27/000001");
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect(await db().transaction((tx) => nextInvoiceNumber(tx, now))).toBe("IFO/26-27/000001");
  });
});

describe("finalizePaidOrder guards", () => {
  it("refuses an unknown provider order and an unknown order id", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const bogus = { providerOrderId: "order_not_ours", providerPaymentId: "pay_x", amountPaise: placed.order.totalPaise, method: null };
    await expect(finalizePaidOrder(db(), placed.order.orderId, bogus, { provider })).rejects.toMatchObject({ code: "unknown_provider_order" });
    await expect(finalizePaidOrder(db(), crypto.randomUUID(), bogus, { provider })).rejects.toMatchObject({ code: "order_not_found" });
  });

  it("refunds a payment captured on a cancelled order instead of confirming it", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    await db().update(orders).set({ status: "cancelled" }).where(eq(orders.id, placed.order.orderId));
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    expect(await fin(placed.order.orderId, paid)).toMatchObject({ outcome: "refunded", reason: "order_closed" });
    expect((await orderRow(placed.order.orderId)).status).toBe("cancelled");
    expect(await stockOf(f.variants.skull!)).toBe(10);
  });

  it("writes only sale movements for the order on a normal finalize", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
    await fin(placed.order.orderId, provider.simulatePayment(placed.payment.razorpayOrderId));
    const moves = await db()
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.orderId, placed.order.orderId)));
    expect(moves.map((m) => [m.reason, m.delta])).toEqual([["sale", -2]]);
  });
});
