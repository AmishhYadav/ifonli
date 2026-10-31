import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { orderEvents, orders, shipments } from "@/server/db/schema";
import { createFromCart } from "@/server/services/orders";
import { lookupOrderForTracking, parseTrackingContact } from "@/server/services/tracking";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import {
  checkoutForm,
  configureCommerce,
  makeCart,
  seedCommerceReference,
} from "./helpers/factories";

const db = () => getDb();
let f: Fixture;

beforeEach(async () => {
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});

/** A COD order (confirmed at once), for buyer@example.com / +919876543210. */
async function placeCod() {
  const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 1 }]);
  const r = await createFromCart(db(), {
    cartToken: cart.token,
    form: checkoutForm({ paymentMethod: "cod" }),
  });
  if (!r.ok) throw new Error(`order failed: ${r.error.code}`);
  return r.order;
}

describe("parseTrackingContact", () => {
  it("normalises emails and Indian mobiles, rejects everything else", () => {
    expect(parseTrackingContact("  Buyer@Example.COM ")).toEqual({
      kind: "email",
      value: "buyer@example.com",
    });
    expect(parseTrackingContact("98765 43210")).toEqual({ kind: "phone", value: "+919876543210" });
    expect(parseTrackingContact("+91-98765-43210")).toEqual({
      kind: "phone",
      value: "+919876543210",
    });
    expect(parseTrackingContact("12345")).toBeNull();
    expect(parseTrackingContact("")).toBeNull();
    expect(parseTrackingContact("x".repeat(300))).toBeNull();
  });
});

describe("lookupOrderForTracking", () => {
  it("finds the order by ref + email, ignoring ref case and email case/spacing", async () => {
    const order = await placeCod();
    const view = await lookupOrderForTracking(db(), {
      ref: ` ${order.ref.toLowerCase()} `,
      emailOrPhone: "  BUYER@example.com ",
    });
    expect(view?.ref).toBe(order.ref);
    expect(view?.statusLabel).toBe("Confirmed");
    expect(view?.totalPaise).toBe(order.totalPaise);
    expect(view?.shipment).toBeNull();
  });

  it("finds the order by ref + phone in any common format", async () => {
    const order = await placeCod();
    for (const phone of ["9876543210", "+91 98765 43210", "098765-43210", "919876543210"]) {
      const view = await lookupOrderForTracking(db(), { ref: order.ref, emailOrPhone: phone });
      expect(view?.ref, phone).toBe(order.ref);
    }
  });

  it("answers null for a wrong email, a wrong phone, an unknown ref and malformed input", async () => {
    const order = await placeCod();
    const miss = async (ref: string, emailOrPhone: string) =>
      lookupOrderForTracking(db(), { ref, emailOrPhone });
    expect(await miss(order.ref, "other@example.com")).toBeNull();
    expect(await miss(order.ref, "9123456789")).toBeNull();
    expect(await miss("IFO-0000-ZZZZ", "buyer@example.com")).toBeNull();
    expect(await miss(order.ref, "")).toBeNull();
    expect(await miss(order.ref, "not an email or phone")).toBeNull();
    expect(await miss("", "buyer@example.com")).toBeNull();
    expect(await miss("x".repeat(500), "buyer@example.com")).toBeNull();
    // A prefix of the right email is not a match.
    expect(await miss(order.ref, "buyer@example.co")).toBeNull();
  });

  it("returns only customer-visible events", async () => {
    const order = await placeCod();
    await db()
      .insert(orderEvents)
      .values({
        orderId: order.orderId,
        type: "internal_note",
        note: "secret",
        visibleToCustomer: false,
      });
    const view = await lookupOrderForTracking(db(), {
      ref: order.ref,
      emailOrPhone: "buyer@example.com",
    });
    expect(view!.events.length).toBeGreaterThan(0);
    expect(view!.events.map((e) => e.type)).toContain("order_placed");
    expect(view!.events.map((e) => e.type)).not.toContain("internal_note");
    expect(JSON.stringify(view)).not.toContain("secret");
  });

  it("includes the latest shipment, and drops a tracking link that is not http(s)", async () => {
    const order = await placeCod();
    await db()
      .update(orders)
      .set({ fulfillmentStatus: "packed" })
      .where(eq(orders.id, order.orderId));
    await db().insert(shipments).values({
      orderId: order.orderId,
      courier: "Delhivery",
      awb: "DL123456789",
      trackingUrl: "https://track.example.com/DL123456789",
      status: "in_transit",
      shippedAt: new Date(),
    });
    let view = await lookupOrderForTracking(db(), {
      ref: order.ref,
      emailOrPhone: "buyer@example.com",
    });
    expect(view?.shipment).toMatchObject({
      courier: "Delhivery",
      awb: "DL123456789",
      trackingUrl: "https://track.example.com/DL123456789",
    });

    await db()
      .update(shipments)
      .set({ trackingUrl: "javascript:alert(1)" })
      .where(eq(shipments.orderId, order.orderId));
    view = await lookupOrderForTracking(db(), {
      ref: order.ref,
      emailOrPhone: "buyer@example.com",
    });
    expect(view?.shipment?.trackingUrl).toBeNull();
    expect(view?.shipment?.courier).toBe("Delhivery");
  });

  it("estimates delivery from the pincode zone while the order is open, not once delivered", async () => {
    const order = await placeCod();
    const open = await lookupOrderForTracking(db(), {
      ref: order.ref,
      emailOrPhone: "buyer@example.com",
    });
    expect(open?.expectedDelivery).toMatchObject({
      fromDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      toDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    await db()
      .update(orders)
      .set({ fulfillmentStatus: "delivered" })
      .where(eq(orders.id, order.orderId));
    const done = await lookupOrderForTracking(db(), {
      ref: order.ref,
      emailOrPhone: "buyer@example.com",
    });
    expect(done?.expectedDelivery).toBeNull();
    expect(done?.statusLabel).toBe("Delivered");
  });
});
