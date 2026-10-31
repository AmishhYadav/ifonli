import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/server/db";
import {
  cartItems,
  carts,
  couponRedemptions,
  invoices,
  notificationOutbox,
  orderEvents,
  orders,
  refunds,
  supportCases,
  user,
  variants,
} from "@/server/db/schema";
import { AmountMismatchError } from "@/server/domain";
import { MockPaymentProvider } from "@/server/payments/mock";
import { reconcilePayments } from "@/server/payments/reconcile";
import { setPaymentProvider } from "@/server/payments/registry";
import { addShipment, refundOrder, updateFulfilment } from "@/server/services/admin/orders";
import { AdminInputError } from "@/server/services/admin/products";
import { resolveSupportCase } from "@/server/services/admin/support";
import {
  addItem,
  cartUsableBy,
  getCartView,
  getOrCreateCart,
  resolveViewerCart,
} from "@/server/services/cart";
import { getOrderGate, resetOrderGateCache } from "@/server/services/commerce/launch-gate";
import { buildInvoiceModel } from "@/server/services/invoices";
import { createFromCart, expireOrder } from "@/server/services/orders";
import { finalizePaidOrder, type CapturedPayment } from "@/server/services/payments";
import { setSetting } from "@/server/services/settings";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import {
  checkoutForm,
  configureCommerce,
  makeCart,
  makeCoupon,
  placeCodOrder,
  placePaidOrder,
  placePrepaidOrder,
  seedCommerceReference,
} from "./helpers/factories";

const db = () => getDb();
const owner = { id: "owner-1", role: "owner" };
const fulfilment = { id: "ful-1", role: "fulfilment" };

let f: Fixture;
let provider: MockPaymentProvider;

beforeEach(async () => {
  provider = new MockPaymentProvider({ deterministic: true });
  setPaymentProvider(provider);
  await db()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" },
      { id: "ful-1", name: "Packer", email: "ful@example.com", role: "fulfilment" },
      { id: "u1", name: "One", email: "u1@example.com" },
      { id: "u2", name: "Two", email: "u2@example.com" },
    ]);
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
  resetOrderGateCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  setPaymentProvider(null);
  resetOrderGateCache();
});

const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!;
const stockOf = async (id: string) =>
  (await db().select({ n: variants.stockOnHand }).from(variants).where(eq(variants.id, id)))[0]!.n;
const events = async (orderId: string, type: string) =>
  db().select().from(orderEvents).where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.type, type)));
const outbox = async (template: string) =>
  db().select().from(notificationOutbox).where(eq(notificationOutbox.template, template));
const captured = (p: { orderId: string | null; id: string; amountPaise: number; method: string | null }): CapturedPayment => ({
  providerOrderId: p.orderId!,
  providerPaymentId: p.id,
  amountPaise: p.amountPaise,
  method: p.method,
});
const fin = (orderId: string, p: Parameters<typeof captured>[0]) =>
  finalizePaidOrder(db(), orderId, captured(p), { provider });

/* ---------------------------------------------------------------------------------------- */

describe("own pending order does not eat its own cart", () => {
  it("keeps the cart lines while its own prepaid order holds the stock, and others still see it as held", async () => {
    await db().update(variants).set({ stockOnHand: 2 }).where(eq(variants.id, f.variants.skull!));
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);

    const view = await getCartView(db(), placed.cart.id);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]!.qty).toBe(2);
    expect(view.notices).toEqual([]);
    expect(await db().select().from(cartItems).where(eq(cartItems.cartId, placed.cart.id))).toHaveLength(1);

    // somebody else's cart really is blocked by the hold
    const other = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const otherView = await getCartView(db(), other.id);
    expect(otherView.lines).toHaveLength(0);
    expect(otherView.notices[0]?.code).toBe("removed_sold_out");
  });

  it("checking out again supersedes the old order instead of failing on its own reservation", async () => {
    await db().update(variants).set({ stockOnHand: 2 }).where(eq(variants.id, f.variants.skull!));
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 2 }]);
    const first = await createFromCart(db(), { cartToken: cart.token, form: checkoutForm() });
    expect(first.ok).toBe(true);
    await getCartView(db(), cart.id); // a page view in between
    const second = await createFromCart(db(), { cartToken: cart.token, form: checkoutForm() });
    expect(second.ok).toBe(true);
  });
});

/* ---------------------------------------------------------------------------------------- */

describe("late capture and coupon limits", () => {
  it("restores the redemption over the usage limit, keeps the sale and tells the admin", async () => {
    const coupon = await makeCoupon({ code: "ONCE", kind: "fixed", value: 5000, usageLimit: 1, perCustomerLimit: 1 });
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }], { couponCode: "ONCE" });
    const { initiateOrderPayment } = await import("@/server/payments/initiate");
    const initiatePayment = (ctx: Parameters<typeof initiateOrderPayment>[0]) => initiateOrderPayment(ctx, { provider });
    const r1 = await createFromCart(db(), { cartToken: cart.token, form: checkoutForm(), initiatePayment });
    const r2 = await createFromCart(db(), { cartToken: cart.token, form: checkoutForm({ phone: "9876543211" }), initiatePayment });
    if (!r1.ok || !r2.ok) throw new Error("setup failed");
    // r1 was superseded (expired, redemption released); r2 holds the only allowed redemption
    const pay2 = provider.simulatePayment(r2.payment!.razorpayOrderId);
    expect((await fin(r2.order.orderId, pay2)).outcome).toBe("finalized");
    const pay1 = provider.simulatePayment(r1.payment!.razorpayOrderId);
    const late = await fin(r1.order.orderId, pay1);
    expect(late).toMatchObject({ outcome: "finalized", late: true });

    expect(await orderRow(r1.order.orderId)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    const reds = await db().select().from(couponRedemptions).where(eq(couponRedemptions.couponId, coupon.id));
    expect(reds.map((x) => x.status)).toEqual(["confirmed", "confirmed"]); // the overshoot is on record
    expect(await events(r1.order.orderId, "coupon_over_limit")).toHaveLength(1);
    expect(await events(r2.order.orderId, "coupon_over_limit")).toHaveLength(0);
    const alerts = (await outbox("payment_anomaly")).filter((a) => (a.payload as { orderId?: string }).orderId === r1.order.orderId);
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("restores quietly when the allowance is still free", async () => {
    await makeCoupon({ code: "PLENTY", kind: "fixed", value: 5000, usageLimit: 5 });
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }], { couponCode: "PLENTY" });
    await expireOrder(db(), placed.order.orderId);
    const r = await fin(placed.order.orderId, provider.simulatePayment(placed.payment.razorpayOrderId));
    expect(r).toMatchObject({ outcome: "finalized", late: true });
    expect(await events(placed.order.orderId, "coupon_over_limit")).toHaveLength(0);
    expect((await db().select().from(couponRedemptions))[0]!.status).toBe("confirmed");
  });
});

/* ---------------------------------------------------------------------------------------- */

describe("amount mismatch after capture", () => {
  it("refunds the whole captured amount automatically and leaves the order unconfirmed", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = provider.simulatePayment(placed.payment.razorpayOrderId, { amountPaise: 100 });
    await expect(fin(placed.order.orderId, paid)).rejects.toBeInstanceOf(AmountMismatchError);

    // not confirmed; the refund settles the payment status like any other refund of a captured payment
    expect((await orderRow(placed.order.orderId)).status).toBe("pending_payment");
    expect((await orderRow(placed.order.orderId)).paidAt).toBeNull();
    const rows = await db().select().from(refunds).where(eq(refunds.orderId, placed.order.orderId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountPaise: 100 });
    expect(rows[0]!.providerRefundId).not.toBeNull();
    expect((await outbox("payment_anomaly"))[0]!.payload).toMatchObject({ kind: "amount_mismatch" });

    // the same payment reported again (webhook after verify) does not refund twice
    await expect(fin(placed.order.orderId, paid)).rejects.toBeInstanceOf(AmountMismatchError);
    expect(await db().select().from(refunds).where(eq(refunds.orderId, placed.order.orderId))).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------------------------------- */

describe("late finalize and the cart", () => {
  it("does not empty a cart the customer has moved on with", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    await addItem(db(), placed.cart.id, { variantId: f.variants.cat!, qty: 1 }); // kept shopping
    await fin(placed.order.orderId, provider.simulatePayment(placed.payment.razorpayOrderId));
    expect(await db().select().from(cartItems).where(eq(cartItems.cartId, placed.cart.id))).toHaveLength(2);
  });

  it("does not empty the cart of a newer checkout when a superseded order is paid late", async () => {
    const { initiateOrderPayment } = await import("@/server/payments/initiate");
    const initiatePayment = (ctx: Parameters<typeof initiateOrderPayment>[0]) => initiateOrderPayment(ctx, { provider });
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const a = await createFromCart(db(), { cartToken: cart.token, form: checkoutForm(), initiatePayment });
    const b = await createFromCart(db(), { cartToken: cart.token, form: checkoutForm({ phone: "9876543211" }), initiatePayment });
    if (!a.ok || !b.ok) throw new Error("setup failed");
    await fin(a.order.orderId, provider.simulatePayment(a.payment!.razorpayOrderId)); // late, superseded
    expect(await db().select().from(cartItems).where(eq(cartItems.cartId, cart.id))).toHaveLength(1);
  });

  it("still clears the cart when the order is the cart's latest and nothing changed", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    await fin(placed.order.orderId, provider.simulatePayment(placed.payment.razorpayOrderId));
    expect(await db().select().from(cartItems).where(eq(cartItems.cartId, placed.cart.id))).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------------------------- */

describe("reconcile sweep fairness", () => {
  it("polls a different window of late candidates instead of the same oldest ones", async () => {
    const orders3 = [];
    for (let i = 0; i < 3; i++) {
      orders3.push(await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]));
    }
    for (const p of orders3) await expireOrder(db(), p.order.orderId);
    // only the LAST one was actually paid at the provider
    provider.simulatePayment(orders3[2]!.payment.razorpayOrderId);

    const first = await reconcilePayments(db(), provider, { limit: 1, random: () => 0 });
    expect(first.finalized).toBe(0); // looked at the oldest, which has nothing
    const second = await reconcilePayments(db(), provider, { limit: 1, random: () => 0.99 });
    expect(second.finalized).toBe(1);
    expect(await orderRow(orders3[2]!.order.orderId)).toMatchObject({ status: "confirmed" });
  });
});

/* ---------------------------------------------------------------------------------------- */

describe("double refund", () => {
  it("two concurrent 'resolve with refund' submits refund once", async () => {
    const paid = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
    const [c] = await db()
      .insert(supportCases)
      .values({ orderId: paid.order.orderId, type: "damaged", description: "Cracked handle on arrival." })
      .returning({ id: supportCases.id });
    const call = () =>
      resolveSupportCase(db(), c!.id, { resolution: "refund", amountPaise: 1_000 }, owner, provider);
    const results = await Promise.allSettled([call(), call()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(AdminInputError);
    expect(await db().select().from(refunds).where(eq(refunds.orderId, paid.order.orderId))).toHaveLength(1);
  });

  it("two concurrent identical refunds from the order page refund once", async () => {
    const paid = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
    const call = () =>
      refundOrder(db(), paid.order.orderId, { amountPaise: 1_000, reason: "Goodwill", restock: [] }, owner, provider);
    const results = await Promise.allSettled([call(), call()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db().select().from(refunds).where(eq(refunds.orderId, paid.order.orderId))).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------------------------------- */

describe("dispatching and restocking", () => {
  it("refuses to pack or ship an order refunded in full", async () => {
    const paid = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    await db().update(orders).set({ paymentStatus: "refunded" }).where(eq(orders.id, paid.order.orderId));
    await expect(updateFulfilment(db(), paid.order.orderId, { to: "packed" }, fulfilment)).rejects.toThrow(/refunded in full/);
    await expect(
      addShipment(db(), paid.order.orderId, { courier: "Delhivery", awb: "123" }, fulfilment),
    ).rejects.toThrow(/refunded in full/);
  });

  it("still ships a partially refunded order", async () => {
    const paid = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    await db().update(orders).set({ paymentStatus: "partially_refunded" }).where(eq(orders.id, paid.order.orderId));
    await addShipment(db(), paid.order.orderId, { courier: "Delhivery", awb: "123" }, fulfilment);
    expect((await orderRow(paid.order.orderId)).fulfillmentStatus).toBe("shipped");
  });

  it("fulfilment staff cannot restock; an owner can, and the default follows the permission", async () => {
    const mk = async () => {
      const cod = await placeCodOrder([{ variantId: f.variants.skull!, qty: 2 }]);
      await db().update(orders).set({ fulfillmentStatus: "rto" }).where(eq(orders.id, cod.order.orderId));
      return cod.order.orderId;
    };
    const before = await stockOf(f.variants.skull!);

    const a = await mk(); // 2 more units out of stock
    await expect(updateFulfilment(db(), a, { to: "returned", restock: true }, fulfilment)).rejects.toThrow(/Forbidden/);
    await updateFulfilment(db(), a, { to: "returned" }, fulfilment); // default for this role: no restock
    expect(await stockOf(f.variants.skull!)).toBe(before - 2);

    const b = await mk();
    await updateFulfilment(db(), b, { to: "returned" }, owner); // default for an owner: restock
    expect(await stockOf(f.variants.skull!)).toBe(before - 2 - 2 + 2);
  });
});

/* ---------------------------------------------------------------------------------------- */

describe("replacement quantity is capped across cases", () => {
  it("subtracts units already replaced by earlier cases", async () => {
    const paid = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
    const orderId = paid.order.orderId;
    const lineId = (await db().query.orderItems.findFirst({ where: (t, { eq: e }) => e(t.orderId, orderId) }))!.id;
    const newCase = async () =>
      (await db().insert(supportCases).values({ orderId, type: "damaged", description: "Damaged on arrival." }).returning({ id: supportCases.id }))[0]!.id;
    const replace = (caseId: string, qty: number) =>
      resolveSupportCase(db(), caseId, { resolution: "replacement", lines: [{ orderItemId: lineId, qty }] }, owner);

    await replace(await newCase(), 1);
    await expect(replace(await newCase(), 2)).rejects.toThrow(/only 1 more/);
    await replace(await newCase(), 1);
    await expect(replace(await newCase(), 1)).rejects.toThrow(/already been replaced/);
  });
});

/* ---------------------------------------------------------------------------------------- */

describe("invoice data is frozen at confirmation", () => {
  const setStore = async (values: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(values)) {
      await (setSetting as (k: string, v: unknown, a: string | null) => Promise<unknown>)(k, v, null);
    }
  };

  it("keeps the seller details of the day of the sale (COD and prepaid)", async () => {
    await setStore({ legal_name: "Old Legal Pvt Ltd", registered_address: "1 Old Road, Mumbai", state: "Maharashtra" });
    const cod = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
    const paid = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    await setStore({ legal_name: "New Legal Pvt Ltd", registered_address: "9 New Road, Delhi" });

    for (const id of [cod.order.orderId, paid.order.orderId]) {
      const model = await buildInvoiceModel(db(), id);
      expect(model.seller.legalName).toBe("Old Legal Pvt Ltd");
      expect(model.seller.address).toBe("1 Old Road, Mumbai");
    }
    const [row] = await db().select().from(invoices).where(eq(invoices.orderId, cod.order.orderId));
    expect(row!.snapshot).not.toBeNull();
  });

  it("falls back to the current settings for an invoice without a snapshot", async () => {
    await setStore({ legal_name: "Old Legal Pvt Ltd", registered_address: "1 Old Road, Mumbai", state: "Maharashtra" });
    const cod = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
    await db().update(invoices).set({ snapshot: null }).where(eq(invoices.orderId, cod.order.orderId));
    await setStore({ legal_name: "New Legal Pvt Ltd" });
    expect((await buildInvoiceModel(db(), cod.order.orderId)).seller.legalName).toBe("New Legal Pvt Ltd");
  });
});

/* ---------------------------------------------------------------------------------------- */

describe("launch gate on order creation", () => {
  it("is open in development and tests", async () => {
    expect(await getOrderGate(db())).toEqual({ open: true, blockers: 0 });
  });

  it("refuses prepaid and COD orders in production while the checklist has blockers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    for (const paymentMethod of ["razorpay", "cod"]) {
      const r = await createFromCart(db(), { cartToken: cart.token, form: checkoutForm({ paymentMethod }) });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("store_closed");
        expect(r.error.message).toMatch(/not taking orders/i);
      }
    }
    expect(await db().select().from(orders)).toHaveLength(0);
    const gate = await getOrderGate(db());
    expect(gate.open).toBe(false);
    expect(gate.blockers).toBeGreaterThan(0);
  });

  it("is switched off by the review flag, even in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEV_PAGES", "1");
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const r = await createFromCart(db(), { cartToken: cart.token, form: checkoutForm({ paymentMethod: "cod" }) });
    expect(r.ok).toBe(true);
  });
});

/* ---------------------------------------------------------------------------------------- */

describe("cart ownership and merge", () => {
  it("never uses a cookie cart that belongs to another account", async () => {
    const theirs = await makeCart([{ variantId: f.variants.skull!, qty: 1 }], { userId: "u1" });
    expect(cartUsableBy(theirs, "u1")).toBe(true);
    expect(cartUsableBy(theirs, "u2")).toBe(false);
    expect(cartUsableBy(theirs, null)).toBe(false);

    // the other user and a guest holding the cookie get nothing (and a new cart, not that one)
    expect(await resolveViewerCart(db(), theirs.token, "u2")).toBeNull();
    expect(await resolveViewerCart(db(), theirs.token, null)).toBeNull();
    const { cart, created } = await getOrCreateCart(db(), theirs.token, "u2");
    expect(created).toBe(true);
    expect(cart.id).not.toBe(theirs.id);
    expect(cart.userId).toBe("u2");
    expect((await db().select().from(carts).where(eq(carts.id, theirs.id)))[0]!.userId).toBe("u1");
    expect(await db().select().from(cartItems).where(eq(cartItems.cartId, theirs.id))).toHaveLength(1);

    // own cart through the cookie, and a guest cart, still work
    expect((await resolveViewerCart(db(), theirs.token, "u1"))!.id).toBe(theirs.id);
    const guest = await makeCart();
    expect((await resolveViewerCart(db(), guest.token, "u2"))!.id).toBe(guest.id);
  });

  it("falls back to the signed-in user's own cart when the cookie cart is someone else's", async () => {
    const theirs = await makeCart([], { userId: "u1" });
    const mine = await makeCart([{ variantId: f.variants.cat!, qty: 1 }], { userId: "u2" });
    expect((await resolveViewerCart(db(), theirs.token, "u2"))!.id).toBe(mine.id);
  });

  it("refuses to place an order from another account's cart", async () => {
    const theirs = await makeCart([{ variantId: f.variants.skull!, qty: 1 }], { userId: "u1" });
    const r = await createFromCart(db(), { cartToken: theirs.token, form: checkoutForm(), userId: "u2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("cart_not_found");
    const own = await createFromCart(db(), { cartToken: theirs.token, form: checkoutForm(), userId: "u1" });
    expect(own.ok).toBe(true);
  });
});
