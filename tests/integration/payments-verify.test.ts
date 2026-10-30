import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import {
  cartItems,
  inventoryMovements,
  invoices,
  notificationOutbox,
  orderEvents,
  orders,
  payments,
  stockReservations,
  variants,
} from "@/server/db/schema";
import { initiateOrderPayment, retryOrderPayment } from "@/server/payments/initiate";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import { handleVerifyRequest } from "@/server/payments/verify";
import { setSetting } from "@/server/services/settings";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import {
  configureCommerce,
  placePrepaidOrder,
  seedCommerceReference,
  verifyBody,
} from "./helpers/factories";

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
const verify = (body: unknown, ip = "1.2.3.4") => handleVerifyRequest(db(), provider, body, { ip });
const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!;

describe("payment initiation", () => {
  it("creates one provider order, stores the payments row and returns the Checkout.js payload", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
    expect(placed.payment).toMatchObject({
      keyId: provider.keyId,
      razorpayOrderId: "order_mock_000001",
      amountPaise: placed.order.totalPaise,
      currency: "INR",
      description: `Order ${placed.order.ref}`,
      mock: true,
      prefill: { name: "Asha Rao", email: "buyer@example.com", contact: "+919876543210" },
      notes: { ref: placed.order.ref },
    });
    expect(provider.orders.get("order_mock_000001")).toMatchObject({ receipt: placed.order.ref, amountPaise: placed.order.totalPaise });
    const rows = await db().select().from(payments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orderId: placed.order.orderId,
      providerOrderId: "order_mock_000001",
      amountPaise: placed.order.totalPaise,
      status: "created",
      providerPaymentId: null,
    });
  });

  it("is idempotent per order: calling again reuses the provider order", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const ctx = {
      orderId: placed.order.orderId,
      ref: placed.order.ref,
      amountPaise: placed.order.totalPaise,
      currency: "INR" as const,
      email: placed.order.email,
      phone: placed.order.phone,
      customerName: "Asha Rao",
      expiresAt: placed.order.expiresAt!,
    };
    const results = await Promise.all([initiateOrderPayment(ctx, { provider }), initiateOrderPayment(ctx, { provider })]);
    for (const r of results) expect(r.ok && r.payload.razorpayOrderId).toBe(placed.payment.razorpayOrderId);
    expect(provider.orders.size).toBe(1);
    expect(await db().select().from(payments)).toHaveLength(1);
  });

  it("reports a provider outage as a retryable failure without leaving a payments row", async () => {
    provider.failNext("createOrder");
    const result = await initiateOrderPayment(
      {
        orderId: crypto.randomUUID(),
        ref: "IFO-2611-AAAA",
        amountPaise: 20000,
        currency: "INR",
        email: "a@b.co",
        phone: "+919876543210",
        customerName: "A",
        expiresAt: new Date(Date.now() + 60_000),
      },
      { provider },
    );
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(await db().select().from(payments)).toHaveLength(0);
  });
});

describe("POST verify", () => {
  it("confirms the order after a signed, captured payment: stock, ledger, invoice, outbox, cart", async () => {
    const placed = await placePrepaidOrder(provider, [
      { variantId: f.variants.skull!, qty: 2 },
      { variantId: f.variants.cat!, qty: 1 },
    ]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    const r = await verify(verifyBody(provider, placed, paid));

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ok: true,
      outcome: "confirmed",
      order: { ref: placed.order.ref, status: "confirmed", paymentStatus: "paid", statusLabel: "Confirmed", paid: true },
    });
    expect(r.productIds).toHaveLength(2);

    const o = await orderRow(placed.order.orderId);
    expect(o).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    expect(o.paidAt).toBeInstanceOf(Date);

    expect(await stockOf(f.variants.skull!)).toBe(8);
    expect(await stockOf(f.variants.cat!)).toBe(2);
    const sales = await db().select().from(inventoryMovements).where(and(eq(inventoryMovements.orderId, o.id), eq(inventoryMovements.reason, "sale")));
    expect(sales.map((s) => s.delta).sort((a, b) => a - b)).toEqual([-2, -1]);
    const res = await db().select().from(stockReservations).where(eq(stockReservations.orderId, o.id));
    expect(res.every((x) => x.status === "converted")).toBe(true);

    const [pay] = await db().select().from(payments);
    expect(pay).toMatchObject({ status: "captured", providerPaymentId: paid.id, method: "upi" });
    expect(JSON.stringify(pay!.raw)).not.toMatch(/email|contact|vpa|card/);

    const [inv] = await db().select().from(invoices);
    expect(inv).toMatchObject({ orderId: o.id, kind: "bill_of_supply" });
    expect(inv!.number).toMatch(/^IFO\/\d{2}-\d{2}\/000001$/);

    const outbox = await db().select().from(notificationOutbox);
    expect(outbox.map((x) => `${x.template}:${x.status}`).sort()).toEqual(["new_order:pending", "order_confirmed:pending"]);
    expect(outbox.find((x) => x.template === "order_confirmed")!.to).toBe("buyer@example.com");

    const events = (await db().select().from(orderEvents).where(eq(orderEvents.orderId, o.id))).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["payment_captured", "order_confirmed", "stock_converted", "invoice_assigned"]));
    expect(await db().select().from(cartItems).where(eq(cartItems.cartId, placed.cart.id))).toHaveLength(0);
  });

  it("issues a tax invoice when a GSTIN is configured", async () => {
    await setSetting("gstin", "27ABCDE1234F1Z5", null);
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    await verify(verifyBody(provider, placed, paid));
    expect((await db().select().from(invoices))[0]!.kind).toBe("tax_invoice");
  });

  it("rejects a forged signature and changes nothing", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    const r = await verify(verifyBody(provider, placed, paid, { razorpay_signature: "0".repeat(64) }));
    expect(r).toMatchObject({ status: 400, body: { ok: false, error: "invalid_signature" } });
    // a signature made with the wrong secret
    const { createHmac } = await import("node:crypto");
    const bad = createHmac("sha256", "not-the-secret").update(`${paid.orderId}|${paid.id}`).digest("hex");
    expect((await verify(verifyBody(provider, placed, paid, { razorpay_signature: bad }))).status).toBe(400);
    const o = await orderRow(placed.order.orderId);
    expect(o.status).toBe("pending_payment");
    expect(await stockOf(f.variants.skull!)).toBe(10);
  });

  it("does not leak whether an order exists: wrong token and unknown ref are both 404", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    expect((await verify(verifyBody(provider, placed, paid, { token: "wrong" }))).status).toBe(404);
    expect((await verify(verifyBody(provider, placed, paid, { ref: "IFO-2611-ZZZZ" }))).status).toBe(404);
    expect((await verify({ nonsense: true })).status).toBe(400);
  });

  it("rejects a payment whose amount differs from the order total, and alerts the admin", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId, { amountPaise: 100 });
    const r = await verify(verifyBody(provider, placed, paid));
    expect(r).toMatchObject({ status: 400, body: { error: "amount_mismatch" } });
    expect((await orderRow(placed.order.orderId)).status).toBe("pending_payment");
    expect(await stockOf(f.variants.skull!)).toBe(10);
    const alerts = await db().select().from(notificationOutbox).where(eq(notificationOutbox.template, "payment_anomaly"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({ kind: "amount_mismatch" });
  });

  it("captures an authorized payment through the API before confirming", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId, { status: "authorized" });
    const r = await verify(verifyBody(provider, placed, paid));
    expect(r.status).toBe(200);
    expect(provider.calls.filter((c) => c.startsWith("capture:"))).toEqual([`capture:${paid.id}:${placed.order.totalPaise}`]);
    expect((await orderRow(placed.order.orderId)).paymentStatus).toBe("paid");
  });

  it("never confirms a payment the provider does not report as captured", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const failed = provider.simulatePayment(placed.payment.razorpayOrderId, { status: "failed" });
    // The signature is valid (the browser could be replaying a failed attempt) but the provider says failed.
    const r = await verify(verifyBody(provider, placed, failed));
    expect(r).toMatchObject({ status: 409, body: { error: "payment_not_captured" } });
    expect((await orderRow(placed.order.orderId)).status).toBe("pending_payment");
    expect(await db().select().from(invoices)).toHaveLength(0);
  });

  it("rejects a payment made against a different provider order than the order's own", async () => {
    const a = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const b = await placePrepaidOrder(provider, [{ variantId: f.variants.ghost!, qty: 1 }]);
    const paidB = provider.simulatePayment(b.payment.razorpayOrderId);
    // Attack: present B's valid payment against order A.
    const r = await verify(verifyBody(provider, a, paidB));
    expect(r.status).toBe(404);
    expect((await orderRow(a.order.orderId)).status).toBe("pending_payment");
  });

  it("reports a provider outage as 502 without touching the order", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    provider.failNext("fetchPayment");
    const r = await verify(verifyBody(provider, placed, paid));
    expect(r.status).toBe(502);
    expect((await orderRow(placed.order.orderId)).status).toBe("pending_payment");
    // the customer's retry (or the webhook) then succeeds
    expect((await verify(verifyBody(provider, placed, paid))).status).toBe(200);
  });

  it("is idempotent: a second verify of the same payment is a no-op", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    const first = await verify(verifyBody(provider, placed, paid));
    const second = await verify(verifyBody(provider, placed, paid));
    expect(first.status === 200 && first.body.outcome).toBe("confirmed");
    expect(second.status === 200 && second.body.outcome).toBe("already_paid");
    expect(await stockOf(f.variants.skull!)).toBe(9);
    expect(await db().select().from(invoices)).toHaveLength(1);
  });

  it("rate limits per IP", async () => {
    let last;
    // malformed bodies are rejected before the limiter, so use well-formed junk
    for (let i = 0; i < 41; i++) {
      last = await verify(
        { razorpay_order_id: "o", razorpay_payment_id: "p", razorpay_signature: "s", ref: `IFO-2611-A${i}`, token: "t" },
        "9.9.9.9",
      );
    }
    expect(last).toMatchObject({ status: 429, body: { error: "rate_limited" } });
  });
});

describe("retryOrderPayment", () => {
  it("re-opens the same provider order while the reservation is valid", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    provider.simulatePayment(placed.payment.razorpayOrderId, { status: "failed" });
    const r = await retryOrderPayment(db(), { ref: placed.order.ref, token: placed.token }, { provider });
    expect(r.ok && r.payload.razorpayOrderId).toBe(placed.payment.razorpayOrderId);
    expect(provider.orders.size).toBe(1);
  });

  it("refuses with a wrong token, after expiry, and once paid", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    expect(await retryOrderPayment(db(), { ref: placed.order.ref, token: "nope" }, { provider })).toMatchObject({ ok: false, code: "not_found" });
    const later = new Date(placed.order.expiresAt!.getTime() + 1000);
    expect(await retryOrderPayment(db(), { ref: placed.order.ref, token: placed.token, now: later }, { provider })).toMatchObject({ ok: false, code: "expired" });
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
    await verify(verifyBody(provider, placed, paid));
    expect(await retryOrderPayment(db(), { ref: placed.order.ref, token: placed.token }, { provider })).toMatchObject({ ok: false, code: "already_paid" });
  });
});
