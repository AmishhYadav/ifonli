import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import {
  cartItems,
  carts,
  couponRedemptions,
  coupons,
  inventoryMovements,
  orderEvents,
  orderItems,
  orders,
  policies,
  stockReservations,
  user,
  variants,
} from "@/server/db/schema";
import { hashAccessToken, verifyAccessToken } from "@/server/domain";
import { addItem } from "@/server/services/cart";
import { getVariantAvailability } from "@/server/services/inventory";
import {
  createFromCart,
  expireOrder,
  getOrderForCustomer,
  releaseExpiredReservations,
  type CreateFromCartResult,
  type PaymentInitiator,
} from "@/server/services/orders";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import {
  checkoutForm,
  configureCommerce,
  makeCart,
  makeCoupon,
  makeProduct,
  makeVariant,
  seedCommerceReference,
} from "./helpers/factories";

const db = () => getDb();
let f: Fixture;

beforeEach(async () => {
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});

type Cart = Awaited<ReturnType<typeof makeCart>>;

function place(
  cart: Cart,
  form: Record<string, unknown> = {},
  extra: Partial<Parameters<typeof createFromCart>[1]> = {},
): Promise<CreateFromCartResult> {
  return createFromCart(db(), { cartToken: cart.token, form: checkoutForm(form), ...extra });
}

function ok(r: CreateFromCartResult) {
  if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
  return r;
}
function err(r: CreateFromCartResult) {
  if (r.ok) throw new Error("expected an error, got an order");
  return r.error;
}

const stockOf = async (variantId: string) =>
  (await db().select({ n: variants.stockOnHand }).from(variants).where(eq(variants.id, variantId)))[0]!.n;
const availOf = async (variantId: string) => (await getVariantAvailability([variantId]))[0]!.available;
const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!;

describe("createFromCart: prepaid", () => {
  it("creates a pending order, snapshots, reservation and events from the server-priced cart", async () => {
    await db().insert(policies).values([
      { slug: "terms", title: "Terms", published: true, version: 3 },
      { slug: "privacy", title: "Privacy", published: true, version: 2 },
      { slug: "returns-refunds", title: "Returns", published: true, version: 1 },
      { slug: "shipping", title: "Shipping", published: true, version: 9 },
    ]);
    const cart = await makeCart([
      { variantId: f.variants.skull!, qty: 2 }, // 398 @ 3% GST, HSN 7117
      { variantId: f.variants.cat!, qty: 1 }, // 99 @ default 18%
    ]);
    const before = Date.now();
    const r = ok(await place(cart, { vibe: "gothic" }));
    expect(r.replayed).toBe(false);
    expect(r.payment).toBeNull();
    const o = r.order;

    expect(o).toMatchObject({
      ref: expect.stringMatching(/^IFO-\d{4}-[0-9A-Z]{4}$/),
      status: "pending_payment",
      paymentStatus: "unpaid",
      paymentMethod: "razorpay",
      subtotalPaise: 49700,
      discountPaise: 0,
      shippingPaise: 5000,
      codFeePaise: 0,
      totalPaise: 54700,
      currency: "INR",
      email: "buyer@example.com",
      phone: "+919876543210",
      requiresPayment: true,
    });
    expect(o.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000);
    expect(o.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000);

    const row = await orderRow(o.orderId);
    expect(row).toMatchObject({
      status: "pending_payment",
      fulfillmentStatus: "unfulfilled",
      vibeAtOrder: "gothic",
      policyAckVersion: "privacy:2,returns-refunds:1,terms:3",
      cartId: cart.id,
      userId: null,
    });
    // only the hash is stored, and it verifies the raw token
    expect(row.accessTokenHash).toBe(hashAccessToken(o.accessToken));
    expect(row.accessTokenHash).not.toContain(o.accessToken);
    expect(verifyAccessToken(o.accessToken, row.accessTokenHash!)).toBe(true);
    expect(row.totalPaise).toBe(row.subtotalPaise - row.discountPaise + row.shippingPaise + row.codFeePaise);
    expect(row.shippingAddress).toEqual({
      name: "Asha Rao",
      phone: "+919876543210",
      line1: "12 Marine Drive",
      line2: null,
      landmark: null,
      city: "Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      pincode: "400001",
      country: "IN",
    });

    const items = await db().select().from(orderItems).where(eq(orderItems.orderId, o.orderId));
    const skull = items.find((i) => i.variantId === f.variants.skull)!;
    expect(skull).toMatchObject({
      productName: "Skull Charm",
      variantTitle: "Default",
      sku: "SK-1",
      imagePath: "/placeholders/cutouts/skull-photo.svg",
      unitPricePaise: 19900,
      mrpPaise: 24900,
      qty: 2,
      discountAllocPaise: 0,
      lineTotalPaise: 39800,
      hsn: "7117",
      gstRateBp: 300,
      taxPaise: 39800 - 38641, // taxable = round(39800 * 10000 / 10300)
    });
    const cat = items.find((i) => i.variantId === f.variants.cat)!;
    expect(cat).toMatchObject({ gstRateBp: 1800, hsn: null, lineTotalPaise: 9900 });
    expect(items.reduce((s, i) => s + i.lineTotalPaise, 0)).toBe(49700);

    // stock is reserved, not decremented, and no ledger rows exist yet
    const res = await db().select().from(stockReservations).where(eq(stockReservations.orderId, o.orderId));
    expect(res.map((x) => [x.variantId, x.qty, x.status]).sort()).toEqual(
      [
        [f.variants.skull, 2, "active"],
        [f.variants.cat, 1, "active"],
      ].sort(),
    );
    expect(res.every((x) => x.expiresAt.getTime() === o.expiresAt!.getTime())).toBe(true);
    expect(await stockOf(f.variants.skull!)).toBe(10);
    expect(await availOf(f.variants.skull!)).toBe(8);
    expect(await db().select().from(inventoryMovements)).toHaveLength(0);

    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, o.orderId));
    expect(events.map((e) => e.type).sort()).toEqual(["order_placed", "stock_reserved"]);
    expect(events.find((e) => e.type === "order_placed")).toMatchObject({
      visibleToCustomer: true,
      toValue: "pending_payment",
    });

    // the cart is kept until payment is captured
    expect(await db().select().from(cartItems).where(eq(cartItems.cartId, cart.id))).toHaveLength(2);
    expect(r.productIds.sort()).toEqual([f.products["skull-charm"]!, f.products["cat-sticker"]!].sort());
  });

  it("uses DB prices only: client-sent totals are ignored", async () => {
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 1 }]);
    const r = ok(await place(cart, { totalPaise: 1, subtotalPaise: 1, items: [] }));
    expect(r.order.totalPaise).toBe(9900 + 5000);
  });

  it("links the order to the signed-in user", async () => {
    await db().insert(user).values({ id: "u1", name: "U", email: "u1@example.com" });
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 1 }]);
    const r = ok(await place(cart, {}, { userId: "u1" }));
    expect((await orderRow(r.order.orderId)).userId).toBe("u1");
  });

  it("reserved stock reduces availability and expiry restores it", async () => {
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 3 }]); // all 3 in stock
    const r = ok(await place(cart));
    expect(await availOf(f.variants.cat!)).toBe(0);
    expect(await stockOf(f.variants.cat!)).toBe(3);

    // not yet due: nothing happens
    expect(await releaseExpiredReservations(db(), new Date(Date.now() + 14 * 60_000))).toEqual({
      expired: 0,
      orderIds: [],
    });
    expect((await orderRow(r.order.orderId)).status).toBe("pending_payment");

    const later = new Date(Date.now() + 16 * 60_000);
    const swept = await releaseExpiredReservations(db(), later);
    expect(swept).toEqual({ expired: 1, orderIds: [r.order.orderId] });
    expect(await releaseExpiredReservations(db(), later)).toMatchObject({ expired: 0 }); // idempotent

    expect((await orderRow(r.order.orderId)).status).toBe("expired");
    const res = await db().select().from(stockReservations).where(eq(stockReservations.orderId, r.order.orderId));
    expect(res.every((x) => x.status === "released")).toBe(true);
    expect(await availOf(f.variants.cat!)).toBe(3);
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, r.order.orderId));
    expect(events.find((e) => e.type === "order_expired")).toMatchObject({
      fromValue: "pending_payment",
      toValue: "expired",
      visibleToCustomer: true,
    });
  });

  it("an expired-but-unswept reservation no longer blocks other buyers (read-time expiry)", async () => {
    const a = await makeCart([{ variantId: f.variants.cat!, qty: 3 }]);
    ok(await place(a, {}, { now: new Date(Date.now() - 20 * 60_000) })); // reservation expired 5 min ago
    expect(await availOf(f.variants.cat!)).toBe(3);
    const b = await makeCart([{ variantId: f.variants.cat!, qty: 3 }]);
    ok(await place(b));
  });

  it("reserves the coupon redemption, and releases it when the order expires", async () => {
    const coupon = await makeCoupon({ code: "SAVE10", kind: "percent", value: 1000, usageLimit: 1 });
    const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 2 }], { couponCode: "SAVE10" }); // 258
    const r = ok(await place(cart));
    expect(r.order).toMatchObject({
      couponCode: "SAVE10",
      discountPaise: 2580,
      totalPaise: 25800 - 2580 + 5000,
    });
    const [item] = await db().select().from(orderItems).where(eq(orderItems.orderId, r.order.orderId));
    expect(item).toMatchObject({ discountAllocPaise: 2580, lineTotalPaise: 23220 });

    const redemptions = () =>
      db().select().from(couponRedemptions).where(eq(couponRedemptions.couponId, coupon.id));
    expect((await redemptions()).map((x) => x.status)).toEqual(["reserved"]);
    expect((await redemptions())[0]!.email).toBe("buyer@example.com");

    // the single use is taken: a second customer is refused
    const other = await makeCart([{ variantId: f.variants.ghost!, qty: 2 }], { couponCode: "SAVE10" });
    expect(err(await place(other, { email: "second@example.com" }))).toMatchObject({
      code: "coupon_invalid",
      message: expect.stringContaining("fully claimed"),
    });

    await expireOrder(db(), r.order.orderId);
    expect((await redemptions()).map((x) => x.status)).toEqual(["released"]);
    ok(await place(other, { email: "second@example.com" })); // now it can be used again
  });

  it("supersedes the cart's earlier pending order, so a customer never blocks themselves", async () => {
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 3 }]); // the whole stock
    const first = ok(await place(cart));
    expect(await availOf(f.variants.cat!)).toBe(0);

    // same cart, different details -> a new order; the first is released first
    const second = ok(
      await place(cart, { shippingAddress: { ...checkoutForm().shippingAddress, line1: "99 New Road" } }),
    );
    expect(second.replayed).toBe(false);
    expect(second.order.orderId).not.toBe(first.order.orderId);
    expect((await orderRow(first.order.orderId)).status).toBe("expired");
    expect((await orderRow(second.order.orderId)).status).toBe("pending_payment");
    expect(await availOf(f.variants.cat!)).toBe(0);
    const active = await db()
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.status, "active"));
    expect(active).toHaveLength(1);
    expect(active[0]!.orderId).toBe(second.order.orderId);
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, first.order.orderId));
    expect(events.find((e) => e.type === "order_expired")).toMatchObject({ visibleToCustomer: false });
  });

  it("switching to COD for the same cart replaces the pending prepaid order", async () => {
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 3 }]);
    const key = crypto.randomUUID();
    const prepaid = ok(await place(cart, { idempotencyKey: key }));
    const cod = ok(await place(cart, { idempotencyKey: key, paymentMethod: "cod" }));
    expect(cod.replayed).toBe(false);
    expect(cod.order.paymentMethod).toBe("cod");
    expect((await orderRow(prepaid.order.orderId)).status).toBe("expired");
    expect(await stockOf(f.variants.cat!)).toBe(0);
  });
});

describe("createFromCart: idempotency", () => {
  it("returns the existing pending order for a repeat submit", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const form = checkoutForm();
    const a = ok(await place(cart, form));
    const b = ok(await place(cart, form));
    expect(b.replayed).toBe(true);
    expect(b.order.orderId).toBe(a.order.orderId);
    expect(b.order.ref).toBe(a.order.ref);
    expect(b.order.totalPaise).toBe(a.order.totalPaise);
    expect(await db().select().from(orders)).toHaveLength(1);
    expect(await db().select().from(stockReservations)).toHaveLength(1);
    expect(await availOf(f.variants.skull!)).toBe(9);

    // a fresh token is issued (the raw one cannot be recovered) and the FIRST one keeps working too
    expect(b.order.accessToken).not.toBe(a.order.accessToken);
    expect(await getOrderForCustomer(db(), b.order.ref, b.order.accessToken)).not.toBeNull();
    expect(await getOrderForCustomer(db(), a.order.ref, a.order.accessToken)).not.toBeNull();
    expect(await getOrderForCustomer(db(), a.order.ref, "not-a-token")).toBeNull();
  });

  it("two parallel submits of the same form create one order", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const form = checkoutForm();
    const results = await Promise.all([place(cart, form), place(cart, form), place(cart, form)]);
    const good = results.map(ok);
    expect(new Set(good.map((g) => g.order.orderId)).size).toBe(1);
    expect(good.filter((g) => !g.replayed)).toHaveLength(1);
    expect(await db().select().from(orders)).toHaveLength(1);
    expect(await availOf(f.variants.skull!)).toBe(9);
  });

  it("a repeat COD submit after the cart was cleared returns the same order and decrements once", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 2 }]);
    const form = checkoutForm({ paymentMethod: "cod" });
    const a = ok(await place(cart, form));
    const b = ok(await place(cart, form));
    expect(b.replayed).toBe(true);
    expect(b.order.orderId).toBe(a.order.orderId);
    expect(await stockOf(f.variants.skull!)).toBe(8);
    expect(await db().select().from(inventoryMovements)).toHaveLength(1);
  });

  it("a changed cart (new version) is a new order even with the same client key", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const form = checkoutForm();
    const a = ok(await place(cart, form));
    await addItem(db(), cart.id, { variantId: f.variants.cat!, qty: 1 });
    const b = ok(await place(cart, form));
    expect(b.replayed).toBe(false);
    expect(b.order.orderId).not.toBe(a.order.orderId);
    expect(b.order.subtotalPaise).toBe(19900 + 9900);
    expect((await orderRow(a.order.orderId)).status).toBe("expired");
  });

  it("the same submit after the attempt expired (or payment could not start) is a fresh attempt, and stays idempotent", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const form = checkoutForm();
    const a = ok(await place(cart, form));
    await expireOrder(db(), a.order.orderId);
    const b = ok(await place(cart, form));
    expect(b.replayed).toBe(false);
    expect(b.order.orderId).not.toBe(a.order.orderId);
    expect((await orderRow(b.order.orderId)).status).toBe("pending_payment");
    // a double click on the new attempt replays it; it does not create a third
    const c = ok(await place(cart, form));
    expect(c.replayed).toBe(true);
    expect(c.order.orderId).toBe(b.order.orderId);
    // and it can expire and be retried again
    await expireOrder(db(), b.order.orderId);
    const d = ok(await place(cart, form));
    expect(d.replayed).toBe(false);
    expect(await db().select().from(orders)).toHaveLength(3);
  });

  it("a failed payment start leaves the cart retryable with the same key", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const form = checkoutForm();
    const fail: PaymentInitiator = async () => ({ ok: false, message: "gateway down" });
    expect(err(await place(cart, form, { initiatePayment: fail })).code).toBe("payment_init_failed");
    const again = ok(await place(cart, form));
    expect(again.replayed).toBe(false);
    expect(again.order.status).toBe("pending_payment");
  });

  it("does not hand back an expired order that had been paid", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const form = checkoutForm();
    const a = ok(await place(cart, form));
    await db().update(orders).set({ status: "cancelled", paidAt: new Date() }).where(eq(orders.id, a.order.orderId));
    expect(err(await place(cart, form)).code).toBe("checkout_expired");
  });
});

describe("createFromCart: COD", () => {
  it("confirms immediately, decrements on-hand via a `sale` movement, adds the fee and clears the cart", async () => {
    await makeCoupon({ code: "SAVE10", kind: "percent", value: 1000 });
    const cart = await makeCart(
      [
        { variantId: f.variants.skull!, qty: 2 },
        { variantId: f.variants.ghost!, qty: 1 },
      ],
      { couponCode: "SAVE10" },
    );
    const r = ok(await place(cart, { paymentMethod: "cod" }));
    expect(r.order).toMatchObject({
      status: "confirmed",
      paymentStatus: "cod_pending",
      paymentMethod: "cod",
      codFeePaise: 4000,
      requiresPayment: false,
      expiresAt: null,
    });
    // 398 + 129 = 527, 10% off = 52.70 -> 5270; free shipping at 527 - 52.70 = 474.30? no: below 500 -> 50
    expect(r.order.discountPaise).toBe(5270);
    expect(r.order.shippingPaise).toBe(5000);
    expect(r.order.totalPaise).toBe(52700 - 5270 + 5000 + 4000);

    expect(await stockOf(f.variants.skull!)).toBe(8);
    expect(await stockOf(f.variants.ghost!)).toBe(19);
    expect(await db().select().from(stockReservations)).toHaveLength(0);
    const moves = await db().select().from(inventoryMovements).where(eq(inventoryMovements.orderId, r.order.orderId));
    expect(moves.map((m) => [m.variantId, m.delta, m.reason]).sort()).toEqual(
      [
        [f.variants.skull, -2, "sale"],
        [f.variants.ghost, -1, "sale"],
      ].sort(),
    );

    // redemption confirmed straight away; cart emptied and its coupon cleared
    const [red] = await db().select().from(couponRedemptions);
    expect(red!.status).toBe("confirmed");
    expect(await db().select().from(cartItems).where(eq(cartItems.cartId, cart.id))).toHaveLength(0);
    expect((await db().select().from(carts).where(eq(carts.id, cart.id)))[0]!.couponCode).toBeNull();

    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, r.order.orderId));
    expect(events.map((e) => e.type).sort()).toEqual([
      "coupon_confirmed",
      "invoice_assigned",
      "order_placed",
      "stock_decremented",
    ]);
  });

  it("does not call the payment initiator", async () => {
    let calls = 0;
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const r = ok(
      await place(cart, { paymentMethod: "cod" }, { initiatePayment: async () => (calls++, { ok: false, message: "x" }) }),
    );
    expect(r.payment).toBeNull();
    expect(calls).toBe(0);
  });

  it("is refused when COD is not allowed for the pincode, the total, or the setting", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const pune = err(
      await place(cart, {
        paymentMethod: "cod",
        shippingAddress: { ...checkoutForm().shippingAddress, pincode: "411001" },
      }),
    );
    expect(pune).toMatchObject({ code: "cod_unavailable" });
    await configureCommerce({ cod_max_order_value: 10000 });
    expect(err(await place(cart, { paymentMethod: "cod" })).message).toContain("up to ₹100");
    await configureCommerce({ cod_enabled: false });
    expect(err(await place(cart, { paymentMethod: "cod" })).code).toBe("cod_unavailable");
    expect(await db().select().from(orders)).toHaveLength(0);
    expect(await stockOf(f.variants.skull!)).toBe(10);
  });
});

describe("createFromCart: validation", () => {
  it("rejects invalid forms with per-field messages", async () => {
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 1 }]);
    const e = err(
      await place(cart, {
        email: "nope",
        phone: "12345",
        policyAck: false,
        shippingAddress: { ...checkoutForm().shippingAddress, pincode: "12" },
      }),
    );
    expect(e.code).toBe("invalid_input");
    expect(e.fieldErrors).toMatchObject({
      email: "Enter a valid email address, like name@example.com",
      phone: "Enter a 10-digit Indian mobile number, like 98765 43210",
      policyAck: expect.stringContaining("tick the box"),
      "shippingAddress.pincode": "Enter a valid 6-digit pincode",
    });
    expect(await db().select().from(orders)).toHaveLength(0);
  });

  it("rejects an unknown cart, an empty cart, and unserviceable pincodes", async () => {
    expect(err(await createFromCart(db(), { cartToken: "z".repeat(32), form: checkoutForm() })).code).toBe(
      "cart_not_found",
    );
    const empty = await makeCart();
    expect(err(await place(empty)).code).toBe("empty_cart");

    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 1 }]);
    const addr = checkoutForm().shippingAddress;
    expect(err(await place(cart, { shippingAddress: { ...addr, pincode: "744101" } }))).toMatchObject({
      code: "not_serviceable",
      message: "Sorry, we can't deliver to 744101 yet.",
    });
    expect(err(await place(cart, { shippingAddress: { ...addr, pincode: "999999" } })).code).toBe(
      "not_serviceable",
    );
  });

  it("the directory state wins over what the customer typed (it decides GST)", async () => {
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 1 }]);
    const r = ok(
      await place(cart, { shippingAddress: { ...checkoutForm().shippingAddress, pincode: "110001", state: "Goa" } }),
    );
    expect(((await orderRow(r.order.orderId)).shippingAddress as { state: string }).state).toBe("Delhi");
  });

  it("re-validates the coupon at order time and asks for it to be removed", async () => {
    await makeCoupon({ code: "SAVE10", endsAt: new Date(Date.now() + 60_000) });
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 1 }], { couponCode: "SAVE10" });
    await db().update(coupons).set({ active: false });
    const e = err(await place(cart));
    expect(e.code).toBe("coupon_invalid");
    expect(e.message).toBe("SAVE10 isn't active right now. Remove the code to continue.");
    expect(await db().select().from(orders)).toHaveLength(0);
  });

  it("enforces the per-email coupon limit using the checkout email", async () => {
    await makeCoupon({ code: "ONCE", perCustomerLimit: 1 });
    const a = await makeCart([{ variantId: f.variants.cat!, qty: 1 }], { couponCode: "ONCE" });
    ok(await place(a, { paymentMethod: "cod" }));
    const b = await makeCart([{ variantId: f.variants.cat!, qty: 1 }], { couponCode: "ONCE" });
    expect(err(await place(b, { paymentMethod: "cod" })).message).toContain("already been used with your email");
    ok(await place(b, { paymentMethod: "cod", email: "different@example.com" }));
  });

  it("rejects a total that cannot be charged", async () => {
    await makeCoupon({ code: "FREE", kind: "fixed", value: 99900 });
    await configureCommerce({ flat_fee: 0 });
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 1 }], { couponCode: "FREE" });
    expect(err(await place(cart)).code).toBe("invalid_total");
  });
});

describe("createFromCart: stock", () => {
  it("reports every short item and rolls everything back", async () => {
    const cart = await makeCart([
      { variantId: f.variants.cat!, qty: 3 },
      { variantId: f.variants.spiky!, qty: 2 },
      { variantId: f.variants.skull!, qty: 1 },
    ]);
    // someone else reserves most of the stock after the items were added
    const rival = await makeCart([{ variantId: f.variants.cat!, qty: 2 }]);
    ok(await place(rival));
    await db().update(variants).set({ stockOnHand: 0 }).where(eq(variants.id, f.variants.spiky!));
    await db().update(variants).set({ active: false }).where(eq(variants.id, f.variants.skull!));

    const e = err(await place(cart));
    expect(e.code).toBe("insufficient_stock");
    expect(e.items).toHaveLength(3);
    expect(e.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variantId: f.variants.cat, reason: "insufficient", requested: 3, available: 1 }),
        expect.objectContaining({ variantId: f.variants.spiky, reason: "sold_out", available: 0 }),
        expect.objectContaining({ variantId: f.variants.skull, reason: "unavailable" }),
      ]),
    );
    expect(e.items!.find((i) => i.variantId === f.variants.cat)!.message).toBe(
      "Only 1 left of Cat Sticker (you have 3 in your bag).",
    );
    // only the rival's order exists
    expect(await db().select().from(orders)).toHaveLength(1);
    expect(await db().select().from(stockReservations)).toHaveLength(1);
  });

  it("enforces max_qty_per_line", async () => {
    await configureCommerce({ max_qty_per_line: 2 });
    const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 3 }]);
    const e = err(await place(cart));
    expect(e.items![0]).toMatchObject({ reason: "max_per_line", available: 2 });
    expect(e.items![0]!.message).toBe("You can buy up to 2 of Ghost Sticker per order.");
  });
});

describe("createFromCart: concurrency on the last unit", () => {
  async function lastUnit(stock = 1) {
    const product = await makeProduct({ status: "active" });
    const variant = await makeVariant(product.id, { stockOnHand: stock, pricePaise: 10000, mrpPaise: 10000 });
    // mirror the opening stock in the ledger so ledger sums can be checked
    await db().insert(inventoryMovements).values({ variantId: variant.id, delta: stock, reason: "restock" });
    return variant;
  }
  async function ledgerSum(variantId: string) {
    const [row] = await db()
      .select({ s: sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)::int` })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variantId));
    return row!.s;
  }

  it("prepaid: N parallel orders for 1 unit -> exactly one wins, the rest get a shortage", async () => {
    const v = await lastUnit();
    const carts_ = await Promise.all(Array.from({ length: 8 }, () => makeCart([{ variantId: v.id, qty: 1 }])));
    const results = await Promise.all(carts_.map((c) => place(c)));

    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(7);
    for (const l of losses) {
      const e = err(l);
      expect(e.code).toBe("insufficient_stock");
      expect(e.items![0]).toMatchObject({ variantId: v.id, reason: "sold_out", available: 0 });
    }
    expect(await stockOf(v.id)).toBe(1);
    expect(await availOf(v.id)).toBe(0);
    const reservations = await db().select().from(stockReservations).where(eq(stockReservations.variantId, v.id));
    expect(reservations).toHaveLength(1);
    expect(await db().select().from(orders)).toHaveLength(1);
  });

  it("COD: N parallel orders for 1 unit -> exactly one wins, stock never negative, ledger = on hand", async () => {
    const v = await lastUnit();
    const carts_ = await Promise.all(Array.from({ length: 8 }, () => makeCart([{ variantId: v.id, qty: 1 }])));
    const results = await Promise.all(carts_.map((c) => place(c, { paymentMethod: "cod" })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    results.filter((r) => !r.ok).forEach((r) => expect(err(r).code).toBe("insufficient_stock"));
    expect(await stockOf(v.id)).toBe(0);
    expect(await ledgerSum(v.id)).toBe(0);
    expect(await ledgerSum(v.id)).toBe(await stockOf(v.id));
  });

  it("mixed prepaid + COD buyers of the last unit: still exactly one", async () => {
    const v = await lastUnit();
    const carts_ = await Promise.all(Array.from({ length: 6 }, () => makeCart([{ variantId: v.id, qty: 1 }])));
    const results = await Promise.all(
      carts_.map((c, i) => place(c, { paymentMethod: i % 2 === 0 ? "cod" : "razorpay" })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const [row] = await db().select({ n: variants.stockOnHand }).from(variants).where(eq(variants.id, v.id));
    expect(row!.n).toBeGreaterThanOrEqual(0);
    expect(await ledgerSum(v.id)).toBe(await stockOf(v.id));
  });

  it("with stock 3 and N buyers of 2 each, only one order fits; no overselling", async () => {
    const v = await lastUnit(3);
    const carts_ = await Promise.all(Array.from({ length: 5 }, () => makeCart([{ variantId: v.id, qty: 2 }])));
    const results = await Promise.all(carts_.map((c) => place(c)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const [row] = await db()
      .select({ reserved: sql<number>`coalesce(sum(${stockReservations.qty}), 0)::int` })
      .from(stockReservations)
      .where(and(eq(stockReservations.variantId, v.id), eq(stockReservations.status, "active")));
    expect(row!.reserved).toBe(2);
    expect(await availOf(v.id)).toBe(1);
  });

  it("an expired reservation frees the unit for the next buyer", async () => {
    const v = await lastUnit();
    const [c1, c2] = await Promise.all([1, 2].map(() => makeCart([{ variantId: v.id, qty: 1 }])));
    const first = ok(await place(c1!));
    expect(err(await place(c2!)).code).toBe("insufficient_stock");
    await releaseExpiredReservations(db(), new Date(Date.now() + 20 * 60_000));
    expect((await orderRow(first.order.orderId)).status).toBe("expired");
    ok(await place(c2!));
  });
});

describe("createFromCart: payment hook", () => {
  const ctxSeen: unknown[] = [];

  it("calls the initiator after commit with the order details and returns its payload", async () => {
    ctxSeen.length = 0;
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const initiatePayment: PaymentInitiator = async (ctx) => {
      ctxSeen.push(ctx);
      // the order is already committed and visible on another connection
      const [row] = await db().select().from(orders).where(eq(orders.id, ctx.orderId));
      expect(row?.status).toBe("pending_payment");
      return {
        ok: true,
        payload: {
          keyId: "rzp_test_x",
          razorpayOrderId: "order_X1",
          amountPaise: ctx.amountPaise,
          currency: "INR",
          prefill: { name: ctx.customerName, email: ctx.email, contact: ctx.phone },
        },
      };
    };
    const r = ok(await place(cart, {}, { initiatePayment }));
    expect(r.payment).toMatchObject({ razorpayOrderId: "order_X1", amountPaise: 19900 + 5000 });
    expect(ctxSeen).toEqual([
      {
        orderId: r.order.orderId,
        ref: r.order.ref,
        amountPaise: 24900,
        currency: "INR",
        email: "buyer@example.com",
        phone: "+919876543210",
        customerName: "Asha Rao",
        expiresAt: r.order.expiresAt,
      },
    ]);
  });

  it("expires the order and releases the reservation when the provider fails (or throws)", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const e = err(
      await place(cart, {}, { initiatePayment: async () => ({ ok: false, message: "Razorpay is down" }) }),
    );
    expect(e).toEqual({ code: "payment_init_failed", message: "Razorpay is down" });
    const [o] = await db().select().from(orders);
    expect(o!.status).toBe("expired");
    expect(await availOf(f.variants.skull!)).toBe(10);

    const again = err(
      await place(
        cart,
        {},
        {
          initiatePayment: async () => {
            throw new Error("boom");
          },
        },
      ),
    );
    expect(again.code).toBe("payment_init_failed");
    expect(again.message).toBe("We couldn't start the payment. Please try again.");
    expect(await availOf(f.variants.skull!)).toBe(10);
    // and a retry (new key) works once the provider is back
    ok(await place(cart));
  });

  it("calls the initiator again when a prepaid order is replayed", async () => {
    let calls = 0;
    const initiatePayment: PaymentInitiator = async (ctx) => {
      calls++;
      return {
        ok: true,
        payload: {
          keyId: "k",
          razorpayOrderId: "order_same",
          amountPaise: ctx.amountPaise,
          currency: "INR",
          prefill: { name: "", email: "", contact: "" },
        },
      };
    };
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const form = checkoutForm();
    ok(await place(cart, form, { initiatePayment }));
    const again = ok(await place(cart, form, { initiatePayment }));
    expect(again.replayed).toBe(true);
    expect(again.payment?.razorpayOrderId).toBe("order_same");
    expect(calls).toBe(2);
    // a failing replay does not expire the still-valid order
    const failed = err(
      await place(cart, form, { initiatePayment: async () => ({ ok: false, message: "later" }) }),
    );
    expect(failed.code).toBe("payment_init_failed");
    const [o] = await db().select().from(orders);
    expect(o!.status).toBe("pending_payment");
  });

  it("runs the in-transaction hook, and a hook failure rolls the order back", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    let seen: string | undefined;
    ok(
      await place(cart, { paymentMethod: "cod" }, {
        hooks: {
          onPlacedInTransaction: async (tx, order) => {
            seen = order.ref;
            const [row] = await tx.select().from(orders).where(eq(orders.id, order.orderId));
            expect(row).toBeDefined();
          },
        },
      }),
    );
    expect(seen).toMatch(/^IFO-/);

    const cart2 = await makeCart([{ variantId: f.variants.ghost!, qty: 1 }]);
    await expect(
      place(cart2, { paymentMethod: "cod" }, {
        hooks: {
          onPlacedInTransaction: async () => {
            throw new Error("outbox down");
          },
        },
      }),
    ).rejects.toThrow("outbox down");
    expect(await db().select().from(orders)).toHaveLength(1);
    expect(await stockOf(f.variants.ghost!)).toBe(20);
  });
});

describe("expireOrder", () => {
  it("expires a pending order on demand and ignores everything else", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const pending = ok(await place(cart));
    expect(await expireOrder(db(), pending.order.orderId)).toEqual({ expired: true });
    expect(await expireOrder(db(), pending.order.orderId)).toEqual({ expired: false });

    const cod = ok(await place(await makeCart([{ variantId: f.variants.ghost!, qty: 1 }]), { paymentMethod: "cod" }));
    expect(await expireOrder(db(), cod.order.orderId)).toEqual({ expired: false });
    expect((await orderRow(cod.order.orderId)).status).toBe("confirmed");
    expect(await expireOrder(db(), "00000000-0000-4000-8000-000000000000")).toEqual({ expired: false });
  });

  it("does not sweep an order that was paid in the meantime", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const r = ok(await place(cart));
    await db().update(orders).set({ status: "confirmed", paymentStatus: "paid" }).where(eq(orders.id, r.order.orderId));
    expect(await releaseExpiredReservations(db(), new Date(Date.now() + 3_600_000))).toMatchObject({ expired: 0 });
    expect((await orderRow(r.order.orderId)).status).toBe("confirmed");
  });
});

describe("getOrderForCustomer", () => {
  it("returns the order only for the right token", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const r = ok(await place(cart));
    const view = await getOrderForCustomer(db(), r.order.ref, r.order.accessToken);
    expect(view).toMatchObject({
      ref: r.order.ref,
      status: "pending_payment",
      statusLabel: "Payment pending",
      totalPaise: 24900,
      email: "buyer@example.com",
    });
    expect(view!.items).toEqual([expect.objectContaining({ productName: "Skull Charm", qty: 1, lineTotalPaise: 19900 })]);
    // customer timeline shows only customer-visible events
    expect(view!.events.map((e) => e.type)).toEqual(["order_placed"]);
    expect(JSON.stringify(view)).not.toContain(r.order.accessToken);
    expect(JSON.stringify(view)).not.toContain("accessTokenHash");

    // ref is normalised
    expect(await getOrderForCustomer(db(), ` ${r.order.ref.toLowerCase()} `, r.order.accessToken)).not.toBeNull();

    expect(await getOrderForCustomer(db(), r.order.ref, "wrong-token")).toBeNull();
    expect(await getOrderForCustomer(db(), r.order.ref, "")).toBeNull();
    expect(await getOrderForCustomer(db(), r.order.ref, r.order.accessToken.slice(0, -1))).toBeNull();
    expect(await getOrderForCustomer(db(), "IFO-0000-ZZZZ", r.order.accessToken)).toBeNull();

    // another order's token does not open this one
    const other = ok(await place(await makeCart([{ variantId: f.variants.ghost!, qty: 1 }])));
    expect(await getOrderForCustomer(db(), r.order.ref, other.order.accessToken)).toBeNull();
    expect(await getOrderForCustomer(db(), other.order.ref, other.order.accessToken)).not.toBeNull();
  });

  it("an order without a stored hash is never readable", async () => {
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }]);
    const r = ok(await place(cart));
    await db().update(orders).set({ accessTokenHash: null }).where(eq(orders.id, r.order.orderId));
    expect(await getOrderForCustomer(db(), r.order.ref, r.order.accessToken)).toBeNull();
  });
});
