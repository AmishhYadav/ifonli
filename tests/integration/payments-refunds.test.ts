import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import {
  adminAuditLog,
  inventoryMovements,
  notificationOutbox,
  orderEvents,
  orders,
  refunds,
  variants,
} from "@/server/db/schema";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import { handleRazorpayWebhook } from "@/server/payments/webhook";
import { finalizePaidOrder } from "@/server/services/payments";
import { createRefund, retryPendingRefunds } from "@/server/services/refunds";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { createOrderFromCartForTests } from "./helpers/cod";
import { configureCommerce, placePrepaidOrder, seedCommerceReference } from "./helpers/factories";

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

/** A paid prepaid order: 2 x skull (398.00) + shipping 50.00 = 44 800 paise. */
async function paidOrder() {
  const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
  const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
  await finalizePaidOrder(
    db(),
    placed.order.orderId,
    { providerOrderId: paid.orderId!, providerPaymentId: paid.id, amountPaise: paid.amountPaise, method: paid.method },
    { provider },
  );
  return { ...placed, paid };
}
const refund = (orderId: string, amountPaise: number, extra: Partial<Parameters<typeof createRefund>[1]> = {}) =>
  createRefund(db(), { orderId, amountPaise, reason: "test", actorId: null, ...extra }, provider);

describe("createRefund: online orders", () => {
  it("books partial then full refunds against captured - refunded", async () => {
    const { order } = await paidOrder();
    expect(order.totalPaise).toBe(44800);

    const first = await refund(order.orderId, 10000);
    expect(first).toMatchObject({ ok: true, status: "processed" });
    expect(await orderRow(order.orderId)).toMatchObject({ paymentStatus: "partially_refunded", status: "confirmed" });

    const tooMuch = await refund(order.orderId, 34801);
    expect(tooMuch).toMatchObject({ ok: false, code: "exceeds_refundable", maxPaise: 34800 });

    const rest = await refund(order.orderId, 34800);
    expect(rest).toMatchObject({ ok: true, status: "processed" });
    expect((await orderRow(order.orderId)).paymentStatus).toBe("refunded");
    expect(await refund(order.orderId, 1)).toMatchObject({ ok: false, code: "nothing_refundable" });

    const rows = await db().select().from(refunds).orderBy(refunds.createdAt);
    expect(rows.map((r) => [r.amountPaise, r.status])).toEqual([[10000, "processed"], [34800, "processed"]]);
    expect(provider.calls.filter((c) => c.startsWith("refund:"))).toHaveLength(2);
    const outbox = await db().select().from(notificationOutbox);
    expect(outbox.filter((o) => o.template === "refund_initiated")).toHaveLength(2);
    expect(outbox.filter((o) => o.template === "refund_processed")).toHaveLength(2);
    expect(await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "order.refund"))).toHaveLength(2);
  });

  it("rejects non-positive and fractional amounts", async () => {
    const { order } = await paidOrder();
    for (const bad of [0, -5, 10.5, Number.NaN]) {
      expect(await refund(order.orderId, bad)).toMatchObject({ ok: false, code: "invalid_amount" });
    }
    expect(await refund(crypto.randomUUID(), 100)).toMatchObject({ ok: false, code: "order_not_found" });
  });

  it("restocks chosen lines through the ledger, once", async () => {
    const { order } = await paidOrder();
    expect(await stockOf(f.variants.skull!)).toBe(8);
    const r = await refund(order.orderId, 19900, { restockLines: [{ variantId: f.variants.skull!, qty: 1 }] });
    expect(r).toMatchObject({ ok: true });
    expect(await stockOf(f.variants.skull!)).toBe(9);
    const moves = await db().select().from(inventoryMovements).where(eq(inventoryMovements.orderId, order.orderId));
    expect(moves.map((m) => [m.reason, m.delta]).sort()).toEqual([["cancel_restock", 1], ["sale", -2]]);

    // only 1 unit left to restock
    const over = await refund(order.orderId, 100, { restockLines: [{ variantId: f.variants.skull!, qty: 2 }] });
    expect(over).toMatchObject({ ok: false, code: "invalid_restock" });
    expect(await stockOf(f.variants.skull!)).toBe(9);
    expect(await db().select().from(refunds)).toHaveLength(1); // the failed attempt rolled back entirely

    const ok2 = await refund(order.orderId, 100, { restockLines: [{ variantId: f.variants.skull!, qty: 1 }], restockReason: "return_restock" });
    expect(ok2).toMatchObject({ ok: true, productIds: expect.any(Array) });
    expect(await stockOf(f.variants.skull!)).toBe(10);
    // a variant that is not on the order
    expect(await refund(order.orderId, 100, { restockLines: [{ variantId: f.variants.cat!, qty: 1 }] })).toMatchObject({ code: "invalid_restock" });
  });

  it("stays pending until the webhook says processed, then settles once", async () => {
    const { order } = await paidOrder();
    provider.refundStatus = "pending";
    const r = await refund(order.orderId, 10000);
    expect(r).toMatchObject({ ok: true, status: "pending" });
    expect((await orderRow(order.orderId)).paymentStatus).toBe("paid"); // money has not moved yet

    // a pending refund still reserves its amount
    expect(await refund(order.orderId, 34801)).toMatchObject({ ok: false, code: "exceeds_refundable", maxPaise: 34800 });

    const pr = [...provider.refunds.values()][0]!;
    const w = provider.buildWebhook("refund.processed", { refund: { ...pr, status: "processed" } });
    const send = () => handleRazorpayWebhook(db(), provider, { rawBody: w.rawBody, signature: w.signature, eventId: w.eventId });
    expect((await send()).status).toBe(200);
    expect((await send()).body).toMatchObject({ duplicate: true });
    // a second event id for the same refund must not double-notify either
    const w2 = provider.buildWebhook("refund.processed", { refund: { ...pr, status: "processed" } });
    await handleRazorpayWebhook(db(), provider, { rawBody: w2.rawBody, signature: w2.signature, eventId: w2.eventId });

    expect((await db().select().from(refunds))[0]).toMatchObject({ status: "processed", providerRefundId: pr.id });
    expect((await orderRow(order.orderId)).paymentStatus).toBe("partially_refunded");
    const outbox = await db().select().from(notificationOutbox);
    expect(outbox.filter((o) => o.template === "refund_processed")).toHaveLength(1);
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, order.orderId));
    expect(events.filter((e) => e.type === "refund_processed")).toHaveLength(1);
  });

  it("marks a refund failed on refund.failed, frees its amount and alerts the admin", async () => {
    const { order } = await paidOrder();
    provider.refundStatus = "pending";
    await refund(order.orderId, 20000);
    const pr = [...provider.refunds.values()][0]!;
    const w = provider.buildWebhook("refund.failed", { refund: { ...pr, status: "failed" } });
    await handleRazorpayWebhook(db(), provider, { rawBody: w.rawBody, signature: w.signature, eventId: w.eventId });
    expect((await db().select().from(refunds))[0]!.status).toBe("failed");
    expect((await orderRow(order.orderId)).paymentStatus).toBe("paid");
    const alerts = await db().select().from(notificationOutbox).where(eq(notificationOutbox.template, "payment_anomaly"));
    expect(alerts.some((a) => (a.payload as { kind?: string }).kind === "refund_failed")).toBe(true);
    // the amount is refundable again
    expect(await refund(order.orderId, 44800)).toMatchObject({ ok: true });
  });

  it("records a refund made from the provider dashboard", async () => {
    const { order, paid } = await paidOrder();
    const pr = await provider.refund(paid.id, { amountPaise: 5000, receipt: "dash", notes: {} });
    const w = provider.buildWebhook("refund.processed", { refund: pr });
    await handleRazorpayWebhook(db(), provider, { rawBody: w.rawBody, signature: w.signature, eventId: w.eventId });
    const rows = await db().select().from(refunds);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ providerRefundId: pr.id, amountPaise: 5000, status: "processed", orderId: order.orderId });
    expect((await orderRow(order.orderId)).paymentStatus).toBe("partially_refunded");
  });

  it("keeps the saved refund and reports providerError when the provider is down; the sweeper completes it", async () => {
    const { order } = await paidOrder();
    provider.failNext("listRefunds");
    const r = await refund(order.orderId, 10000);
    expect(r).toMatchObject({ ok: true, status: "pending", providerRefundId: null });
    expect(r.ok && r.providerError).toBeTruthy();
    await retryPendingRefunds(db(), provider, { now: new Date(Date.now() + 120_000) });
    expect((await db().select().from(refunds))[0]).toMatchObject({ status: "processed" });
    expect(provider.refunds.size).toBe(1);
  });

  it("lets only one of two concurrent full refunds through", async () => {
    const { order } = await paidOrder();
    const results = await Promise.all([refund(order.orderId, 44800), refund(order.orderId, 44800)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(provider.refunds.size).toBe(1);
  });
});

describe("createRefund: COD orders", () => {
  it("records a manual refund with a reference once the cash is collected", async () => {
    const orderId = await createOrderFromCartForTests(f.variants.ghost!);
    expect(await refund(orderId, 1000)).toMatchObject({ ok: false, code: "nothing_refundable" });

    await db().update(orders).set({ paymentStatus: "cod_collected" }).where(eq(orders.id, orderId));
    expect(await refund(orderId, 1000)).toMatchObject({ ok: false, code: "reference_required" });

    const r = await refund(orderId, 5000, { reference: "UPI-123456" });
    expect(r).toMatchObject({ ok: true, status: "manual", providerRefundId: null });
    expect(await orderRow(orderId)).toMatchObject({ paymentStatus: "partially_refunded" });
    expect((await db().select().from(refunds))[0]).toMatchObject({ paymentId: null, status: "manual", reference: "UPI-123456" });
    expect(provider.calls.filter((c) => c.startsWith("refund:"))).toHaveLength(0);

    const total = (await orderRow(orderId)).totalPaise;
    expect(await refund(orderId, total, { reference: "x" })).toMatchObject({ ok: false, code: "exceeds_refundable", maxPaise: total - 5000 });
    expect(await refund(orderId, total - 5000, { reference: "UPI-2" })).toMatchObject({ ok: true });
    expect((await orderRow(orderId)).paymentStatus).toBe("refunded");
  });
});
