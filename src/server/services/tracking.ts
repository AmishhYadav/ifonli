import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import { normalizeIndianPhone } from "@/features/checkout/schema";
import { orderEvents, orders, shipments } from "@/server/db/schema";
import {
  customerStatusLabel,
  normalizeOrderRef,
  type CustomerStatusLabel,
  type FulfillmentStatus,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/server/domain";

import { estimateDelivery, lookupPincodeInfo } from "./commerce/pincode";
import { loadCommerceSettings } from "./commerce/settings";
import type { DbClient } from "./queries/shared";

/**
 * Order tracking for guests (plan 7.11): "order reference + the email or phone used at checkout".
 * Anything that does not match, whatever the reason (no such order, wrong email, wrong phone, bad
 * input), is the same `null`, so the lookup cannot be used to find out which refs or emails exist.
 */

export interface TrackingShipment {
  courier: string;
  awb: string | null;
  /** Courier's tracking page; only http(s) links are ever returned. */
  trackingUrl: string | null;
  status: string;
  shippedAt: Date | null;
  deliveredAt: Date | null;
}

export interface TrackingView {
  ref: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  statusLabel: CustomerStatusLabel;
  paymentMethod: PaymentMethod;
  placedAt: Date;
  totalPaise: number;
  /** Customer-visible timeline, oldest first. */
  events: { type: string; note: string | null; createdAt: Date }[];
  /** Latest shipment, or null before dispatch. */
  shipment: TrackingShipment | null;
  /** India calendar dates ("YYYY-MM-DD") while the order is open and not delivered; else null. */
  expectedDelivery: { fromDate: string; toDate: string } | null;
}

export type TrackingContact = { kind: "email"; value: string } | { kind: "phone"; value: string };

/** Email (lower-cased, trimmed) or Indian mobile (`+91XXXXXXXXXX`); null when it is neither. */
export function parseTrackingContact(raw: string): TrackingContact | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length === 0 || text.length > 254) return null;
  if (text.includes("@")) return { kind: "email", value: text.toLowerCase() };
  const phone = normalizeIndianPhone(text);
  return phone ? { kind: "phone", value: phone } : null;
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Compares fixed-length digests so the time does not depend on how much of the value matched. */
function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/** Customers see only these; anything else on a shipment row is treated as "not usable". */
export function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const NOT_YET_DELIVERED = new Set<FulfillmentStatus>([
  "unfulfilled",
  "packed",
  "shipped",
  "out_for_delivery",
]);

export async function lookupOrderForTracking(
  db: DbClient,
  input: { ref: string; emailOrPhone: string },
): Promise<TrackingView | null> {
  const ref = typeof input.ref === "string" ? normalizeOrderRef(input.ref) : "";
  const contact = parseTrackingContact(input.emailOrPhone);
  // Bad input still runs one lookup below so every "no" costs about the same.
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.ref, ref.length > 0 && ref.length <= 32 ? ref : "-"))
    .limit(1);

  const stored = contact ? (contact.kind === "email" ? order?.email : order?.phone) : null;
  const matches = sameSecret(contact?.value ?? "no-contact", stored ?? "no-order");
  if (!order || !contact || !stored || !matches) return null;

  const [events, [shipment]] = await Promise.all([
    db
      .select({ type: orderEvents.type, note: orderEvents.note, createdAt: orderEvents.createdAt })
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.visibleToCustomer, true)))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id)),
    db
      .select()
      .from(shipments)
      .where(eq(shipments.orderId, order.id))
      .orderBy(desc(shipments.createdAt))
      .limit(1),
  ]);

  const open = order.status === "confirmed" || order.status === "processing";
  const expectedDelivery =
    open && NOT_YET_DELIVERED.has(order.fulfillmentStatus)
      ? await estimateOrderDelivery(db, order.shippingAddress, order.paidAt ?? order.placedAt)
      : null;

  return {
    ref: order.ref,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    statusLabel: customerStatusLabel(order),
    paymentMethod: order.paymentMethod,
    placedAt: order.placedAt,
    totalPaise: order.totalPaise,
    events,
    shipment: shipment
      ? {
          courier: shipment.courier,
          awb: shipment.awb,
          trackingUrl: safeHttpUrl(shipment.trackingUrl),
          status: shipment.status,
          shippedAt: shipment.shippedAt,
          deliveredAt: shipment.deliveredAt,
        }
      : null,
    expectedDelivery,
  };
}

/**
 * Delivery window for an order's address, counted from `from` (payment or placement time) using the
 * current shipping settings. Null when the pincode or a transit range for its zone is unknown.
 */
export async function estimateOrderDelivery(
  db: DbClient,
  shippingAddress: unknown,
  from: Date,
): Promise<{ fromDate: string; toDate: string } | null> {
  const pincode = (shippingAddress as { pincode?: unknown } | null)?.pincode;
  if (typeof pincode !== "string") return null;
  const [info, settings] = await Promise.all([
    lookupPincodeInfo(db, pincode),
    loadCommerceSettings(db),
  ]);
  return estimateDelivery(settings, info, from);
}
