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
  user,
  variants,
} from "@/server/db/schema";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import { addShipment, updateFulfilment } from "@/server/services/admin/orders";
import {
  cancelOrderForCustomer,
  findOrderForAccess,
  getOrderForAccount,
  listAccountOrders,
  type OrderAccess,
} from "@/server/services/customer-orders";
import { setSetting } from "@/server/services/settings";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, placeCodOrder, placePaidOrder, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
const owner = { id: "owner-1", role: "owner" };

let f: Fixture;
let provider: MockPaymentProvider;

beforeEach(async () => {
  provider = new MockPaymentProvider({ deterministic: true });
  setPaymentProvider(provider);
  await db()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" },
      { id: "cust-a", name: "Asha", email: "asha@example.com", emailVerified: true },
      { id: "cust-b", name: "Bela", email: "bela@example.com", emailVerified: true },
    ]);
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});
afterEach(() => setPaymentProvider(null));

const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!;
const stockOf = async (id: string) =>
  (await db().select({ n: variants.stockOnHand }).from(variants).where(eq(variants.id, id)))[0]!.n;
const outbox = async (template: string) =>
  (await db().select().from(notificationOutbox)).filter((r) => r.template === template);
const ip = "203.0.113.7";

const accountOf = (userId: string, email: string | null): Extract<OrderAccess, { kind: "account" }> => ({
  kind: "account",
  userId,
  email,
});
const skull = (qty = 2) => [{ variantId: f.variants.skull!, qty }];

/** Places a COD order for `email` and links it to `userId` when given. */
async function codFor(email: string, userId: string | null = null) {
  const placed = await placeCodOrder(skull(), { form: { email } });
  if (userId) await db().update(orders).set({ userId }).where(eq(orders.id, placed.order.orderId));
  return placed;
}

describe("customer cancel", () => {
  it("cancels a paid prepaid order for its owner: full refund, restock, coupon, e-mail, audit", async () => {
    const { order } = await placePaidOrder(provider, skull(), { form: { email: "asha@example.com" } });
    await db().update(orders).set({ userId: "cust-a" }).where(eq(orders.id, order.orderId));
    expect(await stockOf(f.variants.skull!)).toBe(8);

    const res = await cancelOrderForCustomer(
      db(),
      { ref: order.ref, access: accountOf("cust-a", "asha@example.com"), reason: "Changed my mind", ip },
      { provider },
    );
    expect(res).toMatchObject({ ok: true, alreadyCancelled: false, paymentMethod: "razorpay", refundError: null });
    if (!res.ok) return;
    expect(res.refund).toMatchObject({ amountPaise: 44800 });

    expect(await orderRow(order.orderId)).toMatchObject({ status: "cancelled", paymentStatus: "refunded" });
    expect(await stockOf(f.variants.skull!)).toBe(10);
    const moves = await db().select().from(inventoryMovements).where(eq(inventoryMovements.orderId, order.orderId));
    expect(moves.filter((m) => m.reason === "cancel_restock").map((m) => m.delta)).toEqual([2]);
    const rs = await db().select().from(refunds).where(eq(refunds.orderId, order.orderId));
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ amountPaise: 44800, status: "processed", actorId: "cust-a" });
    expect(await outbox("order_cancelled")).toHaveLength(1);
    expect(await outbox("refund_initiated")).toHaveLength(1);

    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, order.orderId));
    expect(events.find((e) => e.type === "cancel_reason")).toMatchObject({
      note: "Cancelled by customer: Changed my mind",
      visibleToCustomer: false,
    });
    const [audit] = await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "order.cancel"));
    expect(audit).toMatchObject({ actorId: "cust-a", entityId: order.orderId });
    expect(audit!.diff).toMatchObject({ by: "customer" });
  });

  it("cancels a COD order without a refund; a guest holding the link can do it too", async () => {
    const { order, token } = await codFor("guest@example.com");
    const res = await cancelOrderForCustomer(db(), { ref: order.ref, access: { kind: "token", token }, ip }, { provider });
    expect(res).toMatchObject({ ok: true, alreadyCancelled: false, paymentMethod: "cod", refund: null });
    expect(await orderRow(order.orderId)).toMatchObject({ status: "cancelled", paymentStatus: "failed" });
    expect(await stockOf(f.variants.skull!)).toBe(10);
    expect(await db().select().from(refunds)).toHaveLength(0);
    expect(await outbox("order_cancelled")).toHaveLength(1);
    const [audit] = await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "order.cancel"));
    expect(audit!.actorId).toBeNull();
  });

  it("is idempotent: a second cancel changes nothing and says so", async () => {
    const { order, token } = await codFor("guest@example.com");
    const access: OrderAccess = { kind: "token", token };
    await cancelOrderForCustomer(db(), { ref: order.ref, access, ip });
    const again = await cancelOrderForCustomer(db(), { ref: order.ref, access, ip });
    expect(again).toMatchObject({ ok: true, alreadyCancelled: true, refund: null });
    expect(await outbox("order_cancelled")).toHaveLength(1);
    expect(await stockOf(f.variants.skull!)).toBe(10);
  });

  it("refuses once the order is packed, unless the owner's setting allows packed", async () => {
    const { order, token } = await codFor("guest@example.com");
    await updateFulfilment(db(), order.orderId, { to: "packed" }, owner);
    const access: OrderAccess = { kind: "token", token };

    const blocked = await cancelOrderForCustomer(db(), { ref: order.ref, access, ip });
    expect(blocked).toMatchObject({ ok: false, code: "not_cancellable" });
    expect((await orderRow(order.orderId)).status).not.toBe("cancelled");

    await setSetting("cancellable_statuses", ["unfulfilled", "packed"], null);
    const allowed = await cancelOrderForCustomer(db(), { ref: order.ref, access, ip });
    expect(allowed).toMatchObject({ ok: true, alreadyCancelled: false });
  });

  it("never cancels a shipped order, even if the setting lists shipped", async () => {
    await setSetting("cancellable_statuses", ["unfulfilled", "packed", "shipped"], null);
    const { order, token } = await codFor("guest@example.com");
    await addShipment(db(), order.orderId, { courier: "Delhivery" }, owner);
    const res = await cancelOrderForCustomer(db(), { ref: order.ref, access: { kind: "token", token }, ip });
    expect(res).toMatchObject({ ok: false, code: "not_cancellable" });
    expect((await orderRow(order.orderId)).fulfillmentStatus).toBe("shipped");
  });

  it("treats somebody else's order, a wrong token and an unknown ref the same: not found", async () => {
    const { order, token } = await codFor("asha@example.com", "cust-a");
    const notFound = { ok: false, code: "not_found" };

    // another signed-in customer (different id and different verified e-mail)
    expect(
      await cancelOrderForCustomer(db(), { ref: order.ref, access: accountOf("cust-b", "bela@example.com"), ip }),
    ).toMatchObject(notFound);
    // wrong token and no token
    expect(
      await cancelOrderForCustomer(db(), { ref: order.ref, access: { kind: "token", token: "nope-nope-nope" }, ip }),
    ).toMatchObject(notFound);
    expect(await cancelOrderForCustomer(db(), { ref: order.ref, access: { kind: "token", token: "" }, ip })).toMatchObject(
      notFound,
    );
    // unknown ref
    expect(
      await cancelOrderForCustomer(db(), { ref: "IFO-0000-AAAA", access: { kind: "token", token }, ip }),
    ).toMatchObject(notFound);
    expect((await orderRow(order.orderId)).status).toBe("confirmed");
  });

  it("rate limits repeated attempts on the same order", async () => {
    const { order } = await codFor("guest@example.com");
    const access: OrderAccess = { kind: "token", token: "wrong-wrong-wrong" };
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await cancelOrderForCustomer(db(), { ref: order.ref, access, ip }));
    expect(results.slice(0, 6).every((r) => !r.ok && r.code === "not_found")).toBe(true);
    expect(results[7]).toMatchObject({ ok: false, code: "rate_limited" });
  });
});

describe("order ownership and history", () => {
  it("an account sees its own orders and guest orders under its verified e-mail, never others'", async () => {
    const mine = await codFor("asha@example.com", "cust-a");
    const guestSameEmail = await codFor("Asha@Example.com"); // placed as a guest, same address
    const others = await codFor("bela@example.com", "cust-b");
    const strangers = await codFor("someone@example.com");

    const asha = accountOf("cust-a", "asha@example.com");
    const list = await listAccountOrders(db(), asha);
    expect(list.total).toBe(2);
    expect(list.orders.map((o) => o.ref).sort()).toEqual([mine.order.ref, guestSameEmail.order.ref].sort());
    expect(list.orders[0]).toMatchObject({ itemCount: 2, itemNames: ["Skull Charm"] });

    // the detail view follows the same rule
    expect(await getOrderForAccount(db(), mine.order.ref, asha)).toMatchObject({ ref: mine.order.ref });
    expect(await getOrderForAccount(db(), guestSameEmail.order.ref, asha)).not.toBeNull();
    expect(await getOrderForAccount(db(), others.order.ref, asha)).toBeNull();
    expect(await getOrderForAccount(db(), strangers.order.ref, asha)).toBeNull();
    expect(await findOrderForAccess(db(), others.order.ref, asha)).toBeNull();
  });

  it("an unverified e-mail grants nothing by address: only orders linked to the account", async () => {
    const linked = await codFor("asha@example.com", "cust-a");
    const byEmailOnly = await codFor("asha@example.com");
    const unverified = accountOf("cust-a", null);
    const list = await listAccountOrders(db(), unverified);
    expect(list.orders.map((o) => o.ref)).toEqual([linked.order.ref]);
    expect(await getOrderForAccount(db(), byEmailOnly.order.ref, unverified)).toBeNull();
  });

  it("leaves expired checkouts out of the history and paginates newest first", async () => {
    const a = await codFor("asha@example.com", "cust-a");
    const b = await codFor("asha@example.com", "cust-a");
    const c = await codFor("asha@example.com", "cust-a");
    await db().update(orders).set({ status: "expired", paymentStatus: "unpaid" }).where(eq(orders.id, a.order.orderId));
    await db().update(orders).set({ placedAt: new Date(Date.now() - 60_000) }).where(eq(orders.id, b.order.orderId));
    const asha = accountOf("cust-a", "asha@example.com");

    const page1 = await listAccountOrders(db(), asha, { limit: 1, offset: 0 });
    expect(page1.total).toBe(2);
    expect(page1.orders.map((o) => o.ref)).toEqual([c.order.ref]);
    const page2 = await listAccountOrders(db(), asha, { limit: 1, offset: 1 });
    expect(page2.orders.map((o) => o.ref)).toEqual([b.order.ref]);
  });
});
