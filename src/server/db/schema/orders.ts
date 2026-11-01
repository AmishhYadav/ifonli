import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";

import { paise, pk, timestamps, createdAt } from "./_common";
import { user } from "./auth";
import { carts } from "./cart";
import { products, variants } from "./catalog";

// Three independent axes (plan 7.7). Allowed transitions live in application code.
export const orderStatusEnum = pgEnum("order_status", [
  "pending_payment",
  "confirmed",
  "processing",
  "completed",
  "cancelled",
  "expired",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "paid",
  "failed",
  "cod_pending",
  "cod_collected",
  "partially_refunded",
  "refunded",
]);
export const fulfillmentStatusEnum = pgEnum("fulfillment_status", [
  "unfulfilled",
  "packed",
  "shipped",
  "out_for_delivery",
  "delivered",
  "rto",
  "returned",
]);
export const paymentMethodEnum = pgEnum("payment_method", ["razorpay", "cod"]);
export const invoiceKindEnum = pgEnum("invoice_kind", ["tax_invoice", "bill_of_supply"]);

export const orders = pgTable(
  "orders",
  {
    id: pk(),
    /** Human reference, e.g. IFO-2611-7K3Q. */
    ref: text("ref").notNull().unique(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** Cart the order was placed from: lets a newer checkout supersede it and payment clear the cart. */
    cartId: uuid("cart_id").references(() => carts.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    phone: text("phone"),
    status: orderStatusEnum("status").notNull().default("pending_payment"),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("unpaid"),
    fulfillmentStatus: fulfillmentStatusEnum("fulfillment_status").notNull().default("unfulfilled"),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    subtotalPaise: paise("subtotal_paise").notNull(),
    discountPaise: paise("discount_paise").notNull().default(0),
    shippingPaise: paise("shipping_paise").notNull().default(0),
    codFeePaise: paise("cod_fee_paise").notNull().default(0),
    totalPaise: paise("total_paise").notNull(),
    /** GST already included in `total_paise` (display / invoice only, never added on top). */
    taxIncludedPaise: paise("tax_included_paise").notNull().default(0),
    couponCode: text("coupon_code"),
    /** Snapshots: the address as entered, so later edits never rewrite history. */
    shippingAddress: jsonb("shipping_address").notNull(),
    billingAddress: jsonb("billing_address"),
    /** Vibe slug active at checkout; themes the order emails. */
    vibeAtOrder: text("vibe_at_order"),
    /** SHA-256 of the guest access token embedded in `?t=` links. */
    accessTokenHash: text("access_token_hash"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    policyAckVersion: text("policy_ack_version"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** Payment/reservation deadline for pending_payment orders. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("orders_status_placed_at_idx").on(t.status, t.placedAt),
    index("orders_email_idx").on(sql`lower(${t.email})`),
    index("orders_user_idx").on(t.userId, t.placedAt),
    index("orders_cart_idx").on(t.cartId),
    index("orders_phone_idx").on(t.phone),
    index("orders_payment_status_idx").on(t.paymentStatus),
    index("orders_fulfillment_status_idx").on(t.fulfillmentStatus),
    index("orders_pending_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending_payment'`),
    check(
      "orders_amounts_nonneg",
      sql`${t.subtotalPaise} >= 0 AND ${t.discountPaise} >= 0 AND ${t.shippingPaise} >= 0 AND ${t.codFeePaise} >= 0 AND ${t.totalPaise} >= 0 AND ${t.taxIncludedPaise} >= 0`,
    ),
    check(
      "orders_total_consistent",
      sql`${t.totalPaise} = ${t.subtotalPaise} - ${t.discountPaise} + ${t.shippingPaise} + ${t.codFeePaise}`,
    ),
  ],
).enableRLS();

/** Immutable line snapshots: later catalogue edits never change a placed order. */
export const orderItems = pgTable(
  "order_items",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "restrict" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    variantTitle: text("variant_title").notNull(),
    sku: text("sku").notNull(),
    imagePath: text("image_path"),
    unitPricePaise: paise("unit_price_paise").notNull(),
    mrpPaise: paise("mrp_paise").notNull(),
    qty: integer("qty").notNull(),
    discountAllocPaise: paise("discount_alloc_paise").notNull().default(0),
    lineTotalPaise: paise("line_total_paise").notNull(),
    hsn: text("hsn"),
    gstRateBp: integer("gst_rate_bp"),
    taxPaise: paise("tax_paise").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_variant_idx").on(t.variantId),
    check("order_items_qty_pos", sql`${t.qty} > 0`),
    check(
      "order_items_amounts_nonneg",
      sql`${t.unitPricePaise} >= 0 AND ${t.mrpPaise} >= 0 AND ${t.discountAllocPaise} >= 0 AND ${t.lineTotalPaise} >= 0 AND ${t.taxPaise} >= 0`,
    ),
  ],
).enableRLS();

export const shipments = pgTable(
  "shipments",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    courier: text("courier").notNull(),
    awb: text("awb"),
    trackingUrl: text("tracking_url"),
    status: text("status").notNull().default("created"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    events: jsonb("events")
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...timestamps(),
  },
  (t) => [index("shipments_order_idx").on(t.orderId), index("shipments_awb_idx").on(t.awb)],
).enableRLS();

/** The customer-visible / internal timeline. Append-only. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    note: text("note"),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    visibleToCustomer: boolean("visible_to_customer").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
).enableRLS();

export const invoices = pgTable(
  "invoices",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    /** Sequential per financial year, e.g. IFO/26-27/000123. */
    number: text("number").notNull().unique(),
    kind: invoiceKindEnum("kind").notNull(),
    pdfPath: text("pdf_path"),
    /** Seller and tax data frozen at confirmation (`InvoiceSnapshot`); null on invoices from before it existed. */
    snapshot: jsonb("snapshot"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("invoices_order_kind_uq").on(t.orderId, t.kind)],
).enableRLS();

/** Atomic per-financial-year invoice counter: `UPDATE ... SET last_number = last_number + 1 RETURNING`. */
export const invoiceCounters = pgTable("invoice_counters", {
  financialYear: text("financial_year").primaryKey(), // e.g. "26-27"
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
