import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import {
  inventoryMovements,
  invoices,
  notificationOutbox,
  orderEvents,
  orders,
  payments,
  webhookEvents,
  variants,
} from "@/server/db/schema";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import { handleVerifyRequest } from "@/server/payments/verify";
import { handleRazorpayWebhook } from "@/server/payments/webhook";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, placePrepaidOrder, seedCommerceReference, verifyBody } from "./helpers/factories";

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
const hook = (h: { rawBody: string; signature: string; eventId: string }) =>
  handleRazorpayWebhook(db(), provider, { rawBody: h.rawBody, signature: h.signature, eventId: h.eventId });

async function expectExactlyOneFinalize(placed: Awaited<ReturnType<typeof placePrepaidOrder>>, qty: number) {
  expect(await stockOf(f.variants.skull!)).toBe(10 - qty);
  const sales = await db().select().from(inventoryMovements).where(eq(inventoryMovements.orderId, placed.order.orderId));
  expect(sales.filter((s) => s.reason === "sale")).toHaveLength(1);
  const inv = await db().select().from(invoices);
  expect(inv).toHaveLength(1);
  expect(inv[0]!.number).toMatch(/000001$/);
  const outbox = await db().select().from(notificationOutbox);
  expect(outbox.filter((o) => o.template === "order_confirmed")).toHaveLength(1);
  expect(outbox.filter((o) => o.template === "new_order")).toHaveLength(1);
  const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, placed.order.orderId));
  expect(events.filter((e) => e.type === "payment_captured")).toHaveLength(1);
}

describe("POST webhook: authenticity and dedupe", () => {
  it("rejects a forged or missing signature and stores nothing", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    const w = provider.buildWebhook("payment.captured", { payment: paid });
    for (const signature of ["f".repeat(64), "", "garbage"]) {
      const r = await handleRazorpayWebhook(db(), provider, { rawBody: w.rawBody, signature, eventId: w.eventId });
      expect(r.status).toBe(401);
    }
    expect((await handleRazorpayWebhook(db(), provider, { rawBody: w.rawBody, signature: null, eventId: w.eventId })).status).toBe(401);
    // a body altered after signing
    const tampered = w.rawBody.replace(String(placed.order.totalPaise), "100");
    expect((await handleRazorpayWebhook(db(), provider, { rawBody: tampered, signature: w.signature, eventId: w.eventId })).status).toBe(401);
    expect(await db().select().from(webhookEvents)).toHaveLength(0);
    expect((await orderRow(placed.order.orderId)).status).toBe("pending_payment");
  });

  it("uses the WEBHOOK secret: a signature made with the key secret is rejected", async () => {
    const { createHmac } = await import("node:crypto");
    const { MOCK_KEY_SECRET } = await import("@/server/payments/mock");
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    const w = provider.buildWebhook("payment.captured", { payment: paid });
    const signature = createHmac("sha256", MOCK_KEY_SECRET).update(w.rawBody).digest("hex");
    expect((await handleRazorpayWebhook(db(), provider, { rawBody: w.rawBody, signature, eventId: w.eventId })).status).toBe(401);
  });

  it("confirms on payment.captured and processes a replay of the same event id once", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    const w = provider.buildWebhook("payment.captured", { payment: paid });
    const first = await hook(w);
    const replay = await hook(w);
    expect(first).toMatchObject({ status: 200, body: { ok: true } });
    expect(replay).toMatchObject({ status: 200, body: { ok: true, duplicate: true } });
    expect(await orderRow(placed.order.orderId)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    await expectExactlyOneFinalize(placed, 2);
    const [ev] = await db().select().from(webhookEvents);
    expect(ev).toMatchObject({ providerEventId: w.eventId, type: "payment.captured", error: null });
    expect(ev!.processedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(ev!.payload)).not.toMatch(/"(email|contact|vpa)"/);
  });

  it("also finalizes from order.paid (a different event id for the same payment is still safe)", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    await hook(provider.buildWebhook("payment.captured", { payment: paid }));
    await hook(provider.buildWebhook("order.paid", { payment: paid }));
    await expectExactlyOneFinalize(placed, 1);
  });

  it("ignores unknown events and unknown provider orders with a 2xx, and rejects bad JSON", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    const odd = provider.buildWebhook("payment.authorized", { payment: { ...paid, orderId: "order_other_store" } });
    expect((await hook(odd)).status).toBe(200);
    const [ev] = await db().select().from(webhookEvents).where(eq(webhookEvents.providerEventId, odd.eventId));
    expect(ev!.error).toBe("unknown_order");
    expect((await orderRow(placed.order.orderId)).status).toBe("pending_payment");

    const { createHmac } = await import("node:crypto");
    const { MOCK_WEBHOOK_SECRET } = await import("@/server/payments/mock");
    const sign = (b: string) => createHmac("sha256", MOCK_WEBHOOK_SECRET).update(b).digest("hex");
    const other = JSON.stringify({ event: "settlement.processed", payload: {} });
    expect((await handleRazorpayWebhook(db(), provider, { rawBody: other, signature: sign(other), eventId: "evt_x" })).body).toMatchObject({ ignored: true });
    const bad = "{not json";
    expect((await handleRazorpayWebhook(db(), provider, { rawBody: bad, signature: sign(bad), eventId: "evt_y" })).status).toBe(400);
  });

  it("answers 500 (so Razorpay retries) when the provider is down, and succeeds on redelivery", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    const w = provider.buildWebhook("payment.captured", { payment: paid });
    provider.failNext("fetchPayment");
    const r = await hook(w);
    expect(r).toMatchObject({ status: 500, body: { error: "internal" } });
    expect((await db().select().from(webhookEvents))[0]!.processedAt).toBeNull();
    expect((await hook(w)).status).toBe(200);
    await expectExactlyOneFinalize(placed, 1);
  });
});

describe("verify and webhook racing", () => {
  it("verify then webhook ends in exactly one finalize", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    expect((await handleVerifyRequest(db(), provider, verifyBody(provider, placed, paid), { ip: "1.1.1.1" })).status).toBe(200);
    expect((await hook(provider.buildWebhook("payment.captured", { payment: paid }))).status).toBe(200);
    await expectExactlyOneFinalize(placed, 1);
  });

  it("webhook then verify ends in exactly one finalize", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    expect((await hook(provider.buildWebhook("payment.captured", { payment: paid }))).status).toBe(200);
    const v = await handleVerifyRequest(db(), provider, verifyBody(provider, placed, paid), { ip: "1.1.1.1" });
    expect(v.status === 200 && v.body.outcome).toBe("already_paid");
    await expectExactlyOneFinalize(placed, 1);
  });

  it("concurrent verify + webhook(s) finalize once", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 3 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    const w1 = provider.buildWebhook("payment.captured", { payment: paid });
    const w2 = provider.buildWebhook("order.paid", { payment: paid });
    const results = await Promise.all([
      handleVerifyRequest(db(), provider, verifyBody(provider, placed, paid), { ip: "2.2.2.2" }),
      hook(w1),
      hook(w2),
      hook(w1),
    ]);
    for (const r of results) expect(r.status).toBe(200);
    await expectExactlyOneFinalize(placed, 3);
  });
});

describe("payment.failed", () => {
  it("records the attempt, keeps the order pending and lets a later success confirm it", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const failed = provider.simulatePayment(placed.payment.razorpayOrderId, { status: "failed" });
    const w = provider.buildWebhook("payment.failed", { payment: failed });
    expect((await hook(w)).status).toBe(200);
    expect((await hook(w)).body).toMatchObject({ duplicate: true });

    expect(await orderRow(placed.order.orderId)).toMatchObject({ status: "pending_payment", paymentStatus: "failed", paidAt: null });
    expect((await db().select().from(payments))[0]).toMatchObject({ status: "failed", providerPaymentId: failed.id });
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, placed.order.orderId));
    expect(events.filter((e) => e.type === "payment_failed")).toHaveLength(1);
    expect(await stockOf(f.variants.skull!)).toBe(10);
    expect(await db().select().from(invoices)).toHaveLength(0);

    // the customer retries on the same Razorpay order and pays
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    const v = await handleVerifyRequest(db(), provider, verifyBody(provider, placed, paid), { ip: "3.3.3.3" });
    expect(v.status).toBe(200);
    expect(await orderRow(placed.order.orderId)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    expect((await db().select().from(payments))[0]).toMatchObject({ status: "captured", providerPaymentId: paid.id });
  });

  it("ignores a stale failure that arrives after the order was paid", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const failed = provider.simulatePayment(placed.payment.razorpayOrderId, { status: "failed" });
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    await hook(provider.buildWebhook("payment.captured", { payment: paid }));
    await hook(provider.buildWebhook("payment.failed", { payment: failed }));
    expect(await orderRow(placed.order.orderId)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    expect((await db().select().from(payments))[0]).toMatchObject({ status: "captured", providerPaymentId: paid.id });
  });
});
