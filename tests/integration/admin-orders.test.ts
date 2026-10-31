import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { getDb } from "@/server/db";
import { istDateString } from "@/server/domain";
import {
  adminAuditLog,
  inventoryMovements,
  notificationOutbox,
  orderEvents,
  orders,
  refunds,
  shipments,
  stockReservations,
  user,
  variants,
} from "@/server/db/schema";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import {
  addInternalNote,
  addShipment,
  cancelOrder,
  getAdminOrderDetail,
  getPackingSlip,
  listAdminOrders,
  markCodCollected,
  refundOrder,
  resendNotification,
  updateFulfilment,
} from "@/server/services/admin/orders";
import { AdminInputError } from "@/server/services/admin/products";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, placeCodOrder, placePaidOrder, placePrepaidOrder, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
const owner = { id: "owner-1", role: "owner" };
const admin = { id: "admin-1", role: "admin" };
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
      { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" },
      { id: "ful-1", name: "Packer", email: "ful@example.com", role: "fulfilment" },
    ]);
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});
afterEach(() => setPaymentProvider(null));

const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!;
const stockOf = async (id: string) =>
  (await db().select({ n: variants.stockOnHand }).from(variants).where(eq(variants.id, id)))[0]!.n;
const outbox = async (template?: string) => {
  const rows = await db().select().from(notificationOutbox);
  return template ? rows.filter((r) => r.template === template) : rows;
};
const events = async (orderId: string) => db().select().from(orderEvents).where(eq(orderEvents.orderId, orderId));
const audit = async (action: string) => db().select().from(adminAuditLog).where(eq(adminAuditLog.action, action));

/** 2 x skull (398.00) + shipping 50.00 = 44 800 paise, paid. */
const paid = () => placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
const cod = () => placeCodOrder([{ variantId: f.variants.skull!, qty: 2 }]);

describe("admin orders: fulfilment transitions", () => {
  it("walks packed -> shipment -> out for delivery -> delivered, guarded by the state machine", async () => {
    const { order } = await paid();
    const id = order.orderId;

    await expect(updateFulfilment(db(), id, { to: "delivered" }, owner)).rejects.toThrow(/can't move to/);
    await expect(updateFulfilment(db(), id, { to: "out_for_delivery" }, owner)).rejects.toBeInstanceOf(AdminInputError);
    await expect(updateFulfilment(db(), id, { to: "shipped" }, owner)).rejects.toBeInstanceOf(ZodError);

    await updateFulfilment(db(), id, { to: "packed" }, fulfilment);
    expect((await orderRow(id)).fulfillmentStatus).toBe("packed");

    // undo packed
    await updateFulfilment(db(), id, { to: "unfulfilled" }, owner);
    expect((await orderRow(id)).fulfillmentStatus).toBe("unfulfilled");
    await updateFulfilment(db(), id, { to: "packed" }, owner);

    await addShipment(db(), id, { courier: "Delhivery", awb: "DL123" }, fulfilment);
    expect(await orderRow(id)).toMatchObject({ fulfillmentStatus: "shipped", status: "processing" });
    // cannot undo packed once shipped
    await expect(updateFulfilment(db(), id, { to: "unfulfilled" }, owner)).rejects.toThrow(/can't move to/);

    await updateFulfilment(db(), id, { to: "out_for_delivery" }, owner);
    expect(await outbox("order_delivered")).toHaveLength(0);
    await updateFulfilment(db(), id, { to: "delivered" }, owner);
    expect(await orderRow(id)).toMatchObject({ fulfillmentStatus: "delivered", status: "completed" });
    expect(await outbox("order_delivered")).toHaveLength(1);
    const [ship] = await db().select().from(shipments).where(eq(shipments.orderId, id));
    expect(ship).toMatchObject({ status: "delivered" });
    expect(ship!.deliveredAt).not.toBeNull();

    // a completed order cannot be cancelled and delivered can only go to returned
    await expect(cancelOrder(db(), id, { reason: "too late" }, owner, provider)).rejects.toThrow(/can't be cancelled/);
    await expect(updateFulfilment(db(), id, { to: "packed" }, owner)).rejects.toBeInstanceOf(AdminInputError);

    const types = (await events(id)).map((e) => e.type);
    expect(types).toContain("fulfillment_changed");
    expect((await audit("order.delivered")).length).toBe(1);
  });

  it("add shipment from unfulfilled steps through packed, records the shipment and queues order_shipped", async () => {
    const { order } = await paid();
    await addShipment(
      db(),
      order.orderId,
      { courier: "Delhivery", awb: "DL 123/9", trackingUrl: "" },
      fulfilment,
    );
    const [s] = await db().select().from(shipments).where(eq(shipments.orderId, order.orderId));
    expect(s).toMatchObject({ courier: "Delhivery", awb: "DL 123/9", status: "shipped" });
    expect(s!.trackingUrl).toBe("https://www.delhivery.com/track-v2/package/DL%20123%2F9");
    expect(await orderRow(order.orderId)).toMatchObject({ fulfillmentStatus: "shipped" });
    const [mail] = await outbox("order_shipped");
    expect(mail).toMatchObject({ to: "buyer@example.com", status: "pending" });
    expect(mail!.payload).toMatchObject({ ref: order.ref, courier: "Delhivery", awb: "DL 123/9" });
    const evs = await events(order.orderId);
    expect(evs.filter((e) => e.type === "fulfillment_changed" && e.toValue === "packed")).toHaveLength(1);
    expect(evs.find((e) => e.type === "shipment_added")).toMatchObject({ visibleToCustomer: true, actorId: "ful-1" });
    expect((await audit("order.ship")).length).toBe(1);

    // a second parcel on an already shipped order adds a row without a transition
    await addShipment(db(), order.orderId, { courier: "Blue Dart", awb: "BD1", trackingUrl: "https://example.com/t/BD1" }, owner);
    expect(await db().select().from(shipments).where(eq(shipments.orderId, order.orderId))).toHaveLength(2);
    expect(await outbox("order_shipped")).toHaveLength(2);
  });

  it("validates shipments and refuses orders that cannot ship", async () => {
    const { order } = await paid();
    await expect(addShipment(db(), order.orderId, { courier: "" }, owner)).rejects.toBeInstanceOf(ZodError);
    await expect(
      addShipment(db(), order.orderId, { courier: "X", trackingUrl: "javascript:alert(1)" }, owner),
    ).rejects.toBeInstanceOf(ZodError);

    // a pending-payment order cannot be shipped
    const pending = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    await expect(addShipment(db(), pending.order.orderId, { courier: "X" }, owner)).rejects.toThrow(/can't be shipped/);
    await expect(updateFulfilment(db(), pending.order.orderId, { to: "packed" }, owner)).rejects.toBeInstanceOf(AdminInputError);
  });

  it("RTO of a COD order stops expecting cash; returned restocks through the ledger", async () => {
    const { order } = await cod();
    const id = order.orderId;
    expect(await stockOf(f.variants.skull!)).toBe(8);
    await addShipment(db(), id, { courier: "Delhivery", awb: "A1" }, owner);
    await updateFulfilment(db(), id, { to: "rto" }, owner);
    expect(await orderRow(id)).toMatchObject({ fulfillmentStatus: "rto", paymentStatus: "failed" });
    await updateFulfilment(db(), id, { to: "returned" }, owner);
    expect(await stockOf(f.variants.skull!)).toBe(10);
    const moves = await db().select().from(inventoryMovements).where(eq(inventoryMovements.orderId, id));
    expect(moves.filter((m) => m.reason === "return_restock").map((m) => m.delta)).toEqual([2]);
    await expect(updateFulfilment(db(), id, { to: "returned" }, owner)).rejects.toBeInstanceOf(AdminInputError);
  });
});

describe("admin orders: COD collected", () => {
  it("is allowed only for a delivered COD order, once", async () => {
    const { order } = await cod();
    const id = order.orderId;
    await expect(markCodCollected(db(), id, owner)).rejects.toThrow(/delivered/);
    await addShipment(db(), id, { courier: "Delhivery" }, owner);
    await updateFulfilment(db(), id, { to: "delivered" }, owner);
    await markCodCollected(db(), id, owner);
    expect(await orderRow(id)).toMatchObject({ paymentStatus: "cod_collected" });
    expect((await orderRow(id)).paidAt).not.toBeNull();
    await expect(markCodCollected(db(), id, owner)).rejects.toThrow(/already/);
    expect((await audit("order.cod_collected")).length).toBe(1);

    const online = await paid();
    await expect(markCodCollected(db(), online.order.orderId, owner)).rejects.toThrow(/cash-on-delivery/);
  });

  it("is denied to the fulfilment role", async () => {
    const { order } = await cod();
    await expect(markCodCollected(db(), order.orderId, fulfilment)).rejects.toThrow(/Forbidden/);
  });
});

describe("admin orders: cancel", () => {
  it("cancels a paid prepaid order: restock via ledger, full refund row, events, outbox", async () => {
    const { order } = await paid();
    const id = order.orderId;
    expect(await stockOf(f.variants.skull!)).toBe(8);

    const res = await cancelOrder(db(), id, { reason: "Customer asked" }, admin, provider);
    expect(res.refundError).toBeNull();
    expect(res.refund).toMatchObject({ amountPaise: 44800 });
    expect(res.productIds).toHaveLength(1);

    expect(await orderRow(id)).toMatchObject({ status: "cancelled", paymentStatus: "refunded" });
    expect((await orderRow(id)).cancelledAt).not.toBeNull();
    expect(await stockOf(f.variants.skull!)).toBe(10);
    const moves = await db().select().from(inventoryMovements).where(eq(inventoryMovements.orderId, id));
    expect(moves.filter((m) => m.reason === "cancel_restock").map((m) => m.delta)).toEqual([2]);
    const rs = await db().select().from(refunds).where(eq(refunds.orderId, id));
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ amountPaise: 44800, status: "processed", actorId: "admin-1" });
    const types = (await events(id)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["order_cancelled", "cancel_reason", "stock_restocked", "refund_initiated"]));
    expect((await events(id)).find((e) => e.type === "cancel_reason")).toMatchObject({ visibleToCustomer: false });
    expect(await outbox("order_cancelled")).toHaveLength(1);
    expect(await outbox("refund_initiated")).toHaveLength(1);
    expect((await audit("order.cancel")).length).toBe(1);
    // cannot cancel twice
    await expect(cancelOrder(db(), id, { reason: "again" }, admin, provider)).rejects.toThrow(/can't be cancelled/);
  });

  it("cancels a COD order without a refund and restocks", async () => {
    const { order } = await cod();
    const res = await cancelOrder(db(), order.orderId, { reason: "Unreachable by phone" }, owner, provider);
    expect(res.refund).toBeNull();
    expect(await orderRow(order.orderId)).toMatchObject({ status: "cancelled", paymentStatus: "failed" });
    expect(await stockOf(f.variants.skull!)).toBe(10);
    expect(await db().select().from(refunds)).toHaveLength(0);
    expect(await outbox("order_cancelled")).toHaveLength(1);
  });

  it("cancels a pending-payment order by releasing its reservation (no restock, no e-mail)", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
    await cancelOrder(db(), placed.order.orderId, { reason: "Abandoned" }, owner, provider);
    expect(await orderRow(placed.order.orderId)).toMatchObject({ status: "cancelled" });
    const res = await db().select().from(stockReservations).where(eq(stockReservations.orderId, placed.order.orderId));
    expect(res.every((r) => r.status === "released")).toBe(true);
    expect(await stockOf(f.variants.skull!)).toBe(10);
    expect(await outbox("order_cancelled")).toHaveLength(0);
    expect(await db().select().from(inventoryMovements)).toHaveLength(0);
  });

  it("refuses to cancel once shipped, and without a reason", async () => {
    const { order } = await paid();
    await expect(cancelOrder(db(), order.orderId, { reason: "x" }, owner, provider)).rejects.toBeInstanceOf(ZodError);
    await addShipment(db(), order.orderId, { courier: "Delhivery" }, owner);
    await expect(cancelOrder(db(), order.orderId, { reason: "changed mind" }, owner, provider)).rejects.toThrow(
      /already shipped/,
    );
    expect(await db().select().from(refunds)).toHaveLength(0);
  });

  it("is denied to the fulfilment role (owner/admin only)", async () => {
    const { order } = await paid();
    await expect(cancelOrder(db(), order.orderId, { reason: "nope nope" }, fulfilment, provider)).rejects.toThrow(/Forbidden/);
    expect((await orderRow(order.orderId)).status).toBe("confirmed");
  });
});

describe("admin orders: refunds", () => {
  it("caps partial refunds at captured - refunded and restocks chosen lines", async () => {
    const { order } = await paid();
    const id = order.orderId;
    const r1 = await refundOrder(
      db(),
      id,
      { amountPaise: 10000, reason: "Damaged corner", restock: [{ variantId: f.variants.skull!, qty: 1 }] },
      owner,
      provider,
    );
    expect(r1).toMatchObject({ status: "processed" });
    expect(await orderRow(id)).toMatchObject({ paymentStatus: "partially_refunded", status: "confirmed" });
    expect(await stockOf(f.variants.skull!)).toBe(9);

    await expect(refundOrder(db(), id, { amountPaise: 34801, reason: "too much" }, owner, provider)).rejects.toThrow(
      /At most .*348/,
    );
    // restock more than was ordered is refused and nothing is written
    await expect(
      refundOrder(db(), id, { amountPaise: 100, reason: "oops", restock: [{ variantId: f.variants.skull!, qty: 5 }] }, owner, provider),
    ).rejects.toThrow(/restocked/);
    expect(await db().select().from(refunds)).toHaveLength(1);

    await refundOrder(db(), id, { amountPaise: 34800, reason: "Rest" }, admin, provider);
    expect((await orderRow(id)).paymentStatus).toBe("refunded");
    await expect(refundOrder(db(), id, { amountPaise: 1, reason: "again" }, owner, provider)).rejects.toThrow(
      /no collected payment/,
    );
    await expect(refundOrder(db(), id, { amountPaise: 0, reason: "zero" }, owner, provider)).rejects.toBeInstanceOf(ZodError);

    const detail = await getAdminOrderDetail(db(), id);
    expect(detail!.refunds).toHaveLength(2);
    expect(detail!.money).toMatchObject({ capturedPaise: 44800, settledPaise: 44800, refundablePaise: 0 });
    expect(detail!.items[0]!.restockable).toBe(1);
  });

  it("COD refunds are manual and need a UPI/bank reference", async () => {
    const { order } = await cod();
    const id = order.orderId;
    // nothing refundable before the cash is collected
    await expect(refundOrder(db(), id, { amountPaise: 100, reason: "early", reference: "UPI1" }, owner, provider)).rejects.toThrow(
      /no collected payment/,
    );
    await addShipment(db(), id, { courier: "Delhivery" }, owner);
    await updateFulfilment(db(), id, { to: "delivered" }, owner);
    await markCodCollected(db(), id, owner);

    await expect(refundOrder(db(), id, { amountPaise: 5000, reason: "Goodwill" }, owner, provider)).rejects.toThrow(/reference/);
    const r = await refundOrder(db(), id, { amountPaise: 5000, reason: "Goodwill", reference: "UPI-998877" }, owner, provider);
    expect(r.status).toBe("manual");
    const [row] = await db().select().from(refunds).where(eq(refunds.orderId, id));
    expect(row).toMatchObject({ status: "manual", reference: "UPI-998877", paymentId: null, amountPaise: 5000 });
    expect((await orderRow(id)).paymentStatus).toBe("partially_refunded");
    expect(provider.calls.filter((c) => c.startsWith("refund:"))).toHaveLength(0);
  });

  it("is denied to the fulfilment role", async () => {
    const { order } = await paid();
    await expect(refundOrder(db(), order.orderId, { amountPaise: 100, reason: "nope" }, fulfilment, provider)).rejects.toThrow(
      /Forbidden/,
    );
    expect(await db().select().from(refunds)).toHaveLength(0);
  });
});

describe("admin orders: notes, resend, packing slip, list", () => {
  it("adds an internal note that the customer never sees, and audits it", async () => {
    const { order, token } = await paid();
    await addInternalNote(db(), order.orderId, { note: "  Call before dispatch  " }, fulfilment);
    const note = (await events(order.orderId)).find((e) => e.type === "note")!;
    expect(note).toMatchObject({ note: "Call before dispatch", visibleToCustomer: false, actorId: "ful-1" });
    const { getOrderForCustomer } = await import("@/server/services/orders");
    const view = await getOrderForCustomer(db(), order.ref, token);
    expect(view!.events.map((e) => e.note)).not.toContain("Call before dispatch");
    expect((await audit("order.note")).length).toBe(1);
    await expect(addInternalNote(db(), order.orderId, { note: "   " }, owner)).rejects.toBeInstanceOf(ZodError);
  });

  it("resends only e-mails that apply, as new outbox rows; fulfilment may not", async () => {
    const { order } = await paid();
    const before = (await outbox("order_confirmed")).length;
    await resendNotification(db(), order.orderId, { template: "order_confirmed" }, admin);
    expect(await outbox("order_confirmed")).toHaveLength(before + 1);
    await expect(resendNotification(db(), order.orderId, { template: "order_shipped" }, admin)).rejects.toThrow(/doesn't apply/);
    await expect(resendNotification(db(), order.orderId, { template: "order_confirmed" }, fulfilment)).rejects.toThrow(/Forbidden/);
    await addShipment(db(), order.orderId, { courier: "Delhivery", awb: "Z9" }, owner);
    await resendNotification(db(), order.orderId, { template: "order_shipped" }, owner);
    expect(await outbox("order_shipped")).toHaveLength(2);
  });

  it("packing slip carries items and address but no prices or payment details", async () => {
    const { order } = await cod();
    const slip = await getPackingSlip(db(), order.orderId, fulfilment);
    expect(slip).toMatchObject({ ref: order.ref, paymentMethod: "cod" });
    expect(slip!.items).toEqual([{ productName: expect.any(String), variantTitle: expect.any(String), sku: expect.any(String), qty: 2 }]);
    expect(slip!.address.pincode).toBe("400001");
    expect(JSON.stringify(slip)).not.toMatch(/paise|price|total/i);
    await expect(getPackingSlip(db(), order.orderId, { role: "customer" })).rejects.toThrow(/Forbidden/);
  });

  it("lists with filters and server-side pagination", async () => {
    const a = await paid();
    const b = await cod();
    await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]); // pending_payment
    await addShipment(db(), a.order.orderId, { courier: "Delhivery" }, owner);

    const all = await listAdminOrders(db());
    expect(all.total).toBe(3);
    expect(all.items[0]!.placedAt.getTime()).toBeGreaterThanOrEqual(all.items[2]!.placedAt.getTime());
    expect((await listAdminOrders(db(), { status: "pending_payment" })).total).toBe(1);
    expect((await listAdminOrders(db(), { method: "cod" })).items.map((o) => o.ref)).toEqual([b.order.ref]);
    expect((await listAdminOrders(db(), { fulfillmentStatus: "shipped" })).items.map((o) => o.ref)).toEqual([a.order.ref]);
    expect((await listAdminOrders(db(), { paymentStatus: "cod_pending" })).total).toBe(1);
    expect((await listAdminOrders(db(), { q: a.order.ref.toLowerCase() })).items).toHaveLength(1);
    expect((await listAdminOrders(db(), { q: "buyer@example" })).total).toBe(3);
    expect((await listAdminOrders(db(), { q: "98765" })).total).toBe(3);
    expect((await listAdminOrders(db(), { q: "asha" })).total).toBe(3);
    expect((await listAdminOrders(db(), { q: "nobody-here" })).total).toBe(0);
    const today = istDateString(new Date());
    expect((await listAdminOrders(db(), { from: "2999-01-01" })).total).toBe(0);
    expect((await listAdminOrders(db(), { from: "2000-01-01", to: today })).total).toBeGreaterThanOrEqual(2);

    const p1 = await listAdminOrders(db(), { pageSize: 2, page: 1 });
    const p2 = await listAdminOrders(db(), { pageSize: 2, page: 2 });
    expect(p1).toMatchObject({ total: 3, pageCount: 2, page: 1 });
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(1);
    expect(new Set([...p1.items, ...p2.items].map((o) => o.id)).size).toBe(3);
    expect((await listAdminOrders(db(), { pageSize: 2, page: 99 })).page).toBe(2);
    // LIKE wildcards in the search box are literals
    expect((await listAdminOrders(db(), { q: "%" })).total).toBe(0);
  });

  it("detail exposes allowed actions per state", async () => {
    const { order } = await paid();
    let d = await getAdminOrderDetail(db(), order.orderId);
    expect(d!.actions).toMatchObject({ fulfilment: ["packed"], canAddShipment: true, canCancel: true, canRefund: true, canMarkCodCollected: false });
    expect(d!.invoice).toMatchObject({ kind: expect.stringMatching(/tax_invoice|bill_of_supply/), hasPdf: false });
    await addShipment(db(), order.orderId, { courier: "Delhivery" }, owner);
    d = await getAdminOrderDetail(db(), order.orderId);
    expect(d!.actions).toMatchObject({ fulfilment: ["out_for_delivery", "delivered", "rto"], canCancel: false, canAddShipment: true });
    expect(d!.actions.resend).toContain("order_shipped");
    expect(await getAdminOrderDetail(db(), "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
