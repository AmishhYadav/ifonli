import { createHash, createHmac, randomBytes } from "node:crypto";

import type { BrowserContext } from "@playwright/test";

import { assertNotProduction, sql } from "./db";

/**
 * Fixtures shared by the QA specs (visual, accessibility, responsive, golden path). Everything they
 * write is namespaced (`qa-` e-mails, `IFO-QA*` refs, `qa-` cart tokens) and removed by `cleanupQa`.
 */

export const QA_EMAIL_PREFIX = "qa-";
/** Valid order-reference shape (IFO-YYMM-XXXX); the last four characters start with QA for fixtures. */
export const QA_REF_PREFIX = "IFO-2610-QA";
export const SKU = "PH-CHARM-HEART-LILAC";
export const PINCODE_OK = "400001";

/** Commerce settings that make cart, checkout, COD and cancellation behave predictably. */
export const COMMERCE_SETTINGS: Record<string, unknown> = {
  state: "Maharashtra",
  flat_fee: 5000,
  free_threshold: 50000,
  zone_overrides: {},
  serviceability_mode: "all_india",
  processing_days: 1,
  delivery_estimates_by_zone: {
    metro_region: { minDays: 2, maxDays: 4 },
    rest_of_india: { minDays: 3, maxDays: 6 },
  },
  cod_enabled: true,
  cod_fee: 4000,
  cod_max_order_value: 500000,
  cod_excluded_pincodes: [],
  default_gst_rate_bp: 1800,
  shipping_tax_rule: "dominant_line_rate",
  reservation_ttl_minutes: 15,
  max_qty_per_line: 10,
  cancellable_statuses: ["unfulfilled", "packed"],
};

interface Snapshot {
  settings: { key: string; value: unknown; is_placeholder: boolean }[];
  pincode: { cod_allowed: boolean; serviceable: boolean } | undefined;
  variantId: string;
  stock: number;
}

/**
 * Writes the commerce settings, makes the test pincode serviceable with COD and gives the test variant
 * plenty of stock. Returns a function that puts every touched row back.
 */
export async function applyCommerce(): Promise<() => Promise<void>> {
  assertNotProduction();
  const keys = Object.keys(COMMERCE_SETTINGS);
  const settings = await sql<Snapshot["settings"]>`
    select key, value, is_placeholder from settings where key in ${sql(keys)}`;
  const [pincode] = await sql<{ cod_allowed: boolean; serviceable: boolean }[]>`
    select cod_allowed, serviceable from pincodes where pincode = ${PINCODE_OK}`;
  const [variant] = await sql<{ id: string; stock_on_hand: number }[]>`
    select id, stock_on_hand from variants where sku = ${SKU}`;
  if (!variant || !pincode) {
    throw new Error(
      "Seed data missing: run pnpm db:seed, pnpm db:seed-products and the reference import",
    );
  }
  const snapshot: Snapshot = {
    settings,
    pincode,
    variantId: variant.id,
    stock: variant.stock_on_hand,
  };

  for (const [key, value] of Object.entries(COMMERCE_SETTINGS)) {
    await sql`
      insert into settings (key, value, is_placeholder) values (${key}, ${sql.json(value as never)}, false)
      on conflict (key) do update set value = excluded.value, is_placeholder = false`;
  }
  await sql`update pincodes set cod_allowed = true, serviceable = true where pincode = ${PINCODE_OK}`;
  await sql`update variants set stock_on_hand = 200 where id = ${variant.id}`;
  await sql`delete from rate_limits where key like any(array['otp-%','pincode:%','checkout:%','track:%','cancel:%','payverify:%','payretry:%','account-%','wishlist-sync:%','support%','coupon%','contact%'])`;

  return async () => {
    const had = new Set(snapshot.settings.map((s) => s.key));
    for (const key of keys) {
      if (!had.has(key)) await sql`delete from settings where key = ${key}`;
    }
    for (const s of snapshot.settings) {
      await sql`update settings set value = ${sql.json(s.value as never)}, is_placeholder = ${s.is_placeholder} where key = ${s.key}`;
    }
    if (snapshot.pincode) {
      await sql`update pincodes set cod_allowed = ${snapshot.pincode.cod_allowed}, serviceable = ${snapshot.pincode.serviceable} where pincode = ${PINCODE_OK}`;
    }
    await sql`update variants set stock_on_hand = ${snapshot.stock} where id = ${snapshot.variantId}`;
  };
}

export async function testVariantId(): Promise<string> {
  const [variant] = await sql<{ id: string }[]>`select id from variants where sku = ${SKU}`;
  if (!variant) throw new Error(`Seed variant ${SKU} not found: run pnpm db:seed-products`);
  return variant.id;
}

/** A guest cart with `qty` of the test product, wired to the browser through the `cart_token` cookie. */
export async function seedCart(context: BrowserContext, baseURL: string, qty = 2): Promise<void> {
  const variantId = await testVariantId();
  const token = `qa-${randomBytes(18).toString("base64url")}`;
  const [cart] = await sql<{ id: string }[]>`
    insert into carts (token, expires_at) values (${token}, now() + interval '1 day') returning id`;
  await sql`insert into cart_items (cart_id, variant_id, qty) values (${cart!.id}, ${variantId}, ${qty})`;
  await context.addCookies([{ name: "cart_token", value: token, url: baseURL }]);
}

export interface QaOrderOptions {
  ref: string;
  email: string;
  /** The raw `?t=` token the guest link carries. */
  token: string;
  userId?: string;
  paymentMethod: "cod" | "razorpay";
  status: "confirmed" | "processing" | "completed" | "cancelled";
  paymentStatus: "paid" | "cod_pending" | "cod_collected" | "refunded" | "partially_refunded";
  fulfillment: "unfulfilled" | "packed" | "shipped" | "delivered";
  qty?: number;
  shipment?: { courier: string; awb: string; trackingUrl: string };
}

export const hashToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

/** Inserts a complete order (items, GST, timeline, optional shipment) with fixed dates, so pages are stable. */
export async function insertQaOrder(o: QaOrderOptions): Promise<string> {
  const variantId = await testVariantId();
  const [v] = await sql<
    { product_id: string; title: string; price: number; mrp: number; name: string }[]
  >`
    select v.product_id, v.title, v.price_paise as price, v.mrp_paise as mrp, p.name
    from variants v join products p on p.id = v.product_id where v.id = ${variantId}`;
  const qty = o.qty ?? 2;
  const subtotal = v!.price * qty;
  const shipping = subtotal >= 50000 ? 0 : 5000;
  const codFee = o.paymentMethod === "cod" ? 4000 : 0;
  const total = subtotal + shipping + codFee;
  const tax = Math.round((total * 1800) / 11800);
  const address = {
    name: "Asha Rao",
    phone: "9876543210",
    line1: "12 Marine Drive",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
    pincode: PINCODE_OK,
    country: "IN",
  };
  const placed = "2026-10-20T10:30:00+05:30";
  const cancelled = o.status === "cancelled";
  const [order] = await sql<{ id: string }[]>`
    insert into orders (ref, user_id, email, phone, status, payment_status, fulfillment_status, payment_method,
      subtotal_paise, shipping_paise, cod_fee_paise, total_paise, tax_included_paise, shipping_address, billing_address,
      vibe_at_order, access_token_hash, idempotency_key, placed_at, paid_at, cancelled_at)
    values (${o.ref}, ${o.userId ?? null}, ${o.email}, '9876543210', ${o.status}::order_status,
      ${o.paymentStatus}::payment_status, ${o.fulfillment}::fulfillment_status, ${o.paymentMethod}::payment_method,
      ${subtotal}, ${shipping}, ${codFee}, ${total}, ${tax}, ${sql.json(address)}, ${sql.json(address)},
      'cute', ${hashToken(o.token)}, ${`qa-${o.ref}`}, ${placed},
      ${o.paymentMethod === "razorpay" ? placed : null}, ${cancelled ? "2026-10-21T09:00:00+05:30" : null})
    returning id`;
  const orderId = order!.id;
  await sql`
    insert into order_items (order_id, variant_id, product_id, product_name, variant_title, sku, image_path,
      unit_price_paise, mrp_paise, qty, line_total_paise, gst_rate_bp, tax_paise)
    values (${orderId}, ${variantId}, ${v!.product_id}, ${v!.name}, ${v!.title}, ${SKU},
      '/placeholders/cutouts/charm-heart.svg', ${v!.price}, ${Math.max(v!.mrp, v!.price)}, ${qty}, ${subtotal},
      1800, ${Math.round((subtotal * 1800) / 11800)})`;
  await sql`
    insert into order_events (order_id, type, to_value, note, visible_to_customer, created_at)
    values (${orderId}, 'order_confirmed', 'confirmed', 'Order confirmed', true, ${placed})`;
  if (o.shipment) {
    await sql`
      insert into shipments (order_id, courier, awb, tracking_url, status, shipped_at)
      values (${orderId}, ${o.shipment.courier}, ${o.shipment.awb}, ${o.shipment.trackingUrl}, 'in_transit',
        '2026-10-22T11:00:00+05:30')`;
  }
  return orderId;
}

/** The signed `ifonli.session_token` cookie value Better Auth would set (token + HMAC-SHA256 signature). */
export function signedSessionCookie(token: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET must be set (same value as the server)");
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

export interface CustomerSession {
  userId: string;
  /** Value of the signed `ifonli.session_token` cookie. */
  cookie: string;
}

/** Creates a customer (no OTP round trip) with a live session row. */
export async function createCustomerSession(
  email: string,
  name = "Asha Rao",
): Promise<CustomerSession> {
  const [existing] = await sql<{ id: string }[]>`select id from "user" where email = ${email}`;
  const userId = existing?.id ?? `qa-user-${randomBytes(6).toString("hex")}`;
  if (!existing) {
    await sql`insert into "user" (id, name, email, email_verified, role) values (${userId}, ${name}, ${email}, true, 'customer')`;
  }
  const token = randomBytes(24).toString("base64url");
  await sql`
    insert into session (id, expires_at, token, user_id, updated_at)
    values (${`qa-session-${randomBytes(6).toString("hex")}`}, now() + interval '1 day', ${token}, ${userId}, now())`;
  return { userId, cookie: signedSessionCookie(token) };
}

export async function applyCustomerSession(
  context: BrowserContext,
  baseURL: string,
  session: CustomerSession,
): Promise<void> {
  await context.addCookies([
    {
      name: "ifonli.session_token",
      value: session.cookie,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/** Signs a new customer in on `context`. Returns the user id, for orders that should appear in the account. */
export async function signInCustomer(
  context: BrowserContext,
  baseURL: string,
  email: string,
  name = "Asha Rao",
): Promise<string> {
  const session = await createCustomerSession(email, name);
  await applyCustomerSession(context, baseURL, session);
  return session.userId;
}

/** Removes everything the QA fixtures created. */
export async function cleanupQa(): Promise<void> {
  const ids = sql`(select id from orders where ref like ${QA_REF_PREFIX + "%"} or email like ${QA_EMAIL_PREFIX + "%"})`;
  await sql`delete from notification_outbox where order_id in ${ids}`;
  await sql`delete from inventory_movements where order_id in ${ids}`;
  await sql`delete from invoices where order_id in ${ids}`;
  await sql`delete from refunds where order_id in ${ids}`;
  await sql`delete from payments where order_id in ${ids}`;
  await sql`delete from support_cases where order_id in ${ids}`;
  await sql`delete from orders where ref like ${QA_REF_PREFIX + "%"} or email like ${QA_EMAIL_PREFIX + "%"}`;
  await sql`delete from notification_outbox where "to" like ${QA_EMAIL_PREFIX + "%"}`;
  await sql`delete from "user" where email like ${QA_EMAIL_PREFIX + "%"}`;
  await sql`delete from verification where identifier like ${"%" + QA_EMAIL_PREFIX + "%"}`;
  await sql`delete from carts where token like 'qa-%'`;
}
