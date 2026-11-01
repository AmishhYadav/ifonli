import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { isAdminRole } from "@/server/auth/permissions";
import {
  addresses,
  carts,
  contactMessages,
  couponRedemptions,
  coupons,
  customerProfiles,
  notificationOutbox,
  orderEvents,
  orderItems,
  orders,
  products,
  session,
  shipments,
  supportCases,
  user,
  verification,
  wishlistItems,
} from "@/server/db/schema";

import { removeObjects } from "@/server/storage";

import { writeAudit } from "./audit";
import type { DbClient } from "./queries/shared";

/**
 * DPDP Act 2023 / Rules 2025 (plan 3): "download my data" and "delete my account". Reusable by the
 * customer account page and, later, the admin Customers module (pass the staff member as `actor`).
 *
 * Retention (documented in docs/DECISIONS.md, D-DPDP-1):
 *  - deleted: the login (user, sessions, accounts), profile, saved addresses, wishlist, open carts,
 *    unused sign-in codes, every e-mail in the notification outbox (to the customer's address or
 *    about their orders), their contact-form messages and the photos of their support cases;
 *  - anonymised: the free text of their support cases ("removed at the customer's request"; the case
 *    itself, its type, status and resolution stay with the order) and the e-mail on their coupon
 *    redemptions;
 *  - kept: orders and their lines, events, shipments, invoices and refunds, which hold the name,
 *    address, e-mail and phone the customer typed at checkout. They are tax and accounting records
 *    and a consumer-protection evidence trail; `orders.user_id` is set to NULL by the foreign key, so
 *    they no longer belong to any account.
 * "Their orders" means orders linked to the account or placed with its verified e-mail address (the
 * same rule as the export).
 */

/** Replaces a deleted customer's free text on support cases. */
export const SUPPORT_TEXT_REMOVED = "[Removed at the customer's request]";

export const EXPORT_FORMAT_VERSION = 1;

export interface ExportedOrder {
  ref: string;
  placedAt: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  paymentMethod: string;
  email: string;
  phone: string | null;
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
  taxIncludedPaise: number;
  couponCode: string | null;
  shippingAddress: unknown;
  items: { productName: string; variantTitle: string; sku: string; qty: number; unitPricePaise: number; lineTotalPaise: number }[];
  shipments: { courier: string; awb: string | null; trackingUrl: string | null; status: string; shippedAt: string | null; deliveredAt: string | null }[];
  timeline: { at: string; event: string; note: string | null }[];
}

export interface ExportedSupportCase {
  orderRef: string;
  type: string;
  description: string;
  photos: number;
  status: string;
  resolution: string | null;
  createdAt: string;
}

export interface ExportedContactMessage {
  createdAt: string;
  orderRef: string | null;
  message: string;
}

export interface ExportedCouponRedemption {
  couponCode: string;
  orderRef: string;
  email: string;
  status: string;
  createdAt: string;
}

export interface ExportedNotification {
  channel: string;
  template: string;
  to: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  payload: unknown;
}

export interface CustomerDataExport {
  formatVersion: number;
  exportedAt: string;
  account: { id: string; name: string; email: string; emailVerified: boolean; createdAt: string };
  profile: { phone: string | null; marketingOptIn: boolean };
  addresses: {
    name: string;
    phone: string;
    line1: string;
    line2: string | null;
    landmark: string | null;
    city: string;
    state: string;
    pincode: string;
    isDefault: boolean;
    createdAt: string;
  }[];
  orders: ExportedOrder[];
  wishlist: { productId: string; productName: string | null; savedAt: string }[];
  supportCases: ExportedSupportCase[];
  contactMessages: ExportedContactMessage[];
  couponRedemptions: ExportedCouponRedemption[];
  /** E-mails sent to the customer (order updates, sign-in codes are not kept). */
  notifications: ExportedNotification[];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Orders that belong to the customer: linked to the account, or placed with its verified e-mail. */
function ownedOrders(userId: string, verifiedEmail: string | null) {
  const byUser = eq(orders.userId, userId);
  return verifiedEmail ? or(byUser, sql`lower(${orders.email}) = ${verifiedEmail.toLowerCase()}`) : byUser;
}

type OrderRow = typeof orders.$inferSelect;

/** Order lines, shipments, customer-visible timeline and support cases of the given orders, in export shape. */
async function loadOrderBundle(
  db: DbClient,
  orderRows: OrderRow[],
): Promise<{ orders: ExportedOrder[]; supportCases: ExportedSupportCase[] }> {
  const orderIds = orderRows.map((o) => o.id);
  const [items, ships, events, cases] = orderIds.length
    ? await Promise.all([
        db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)).orderBy(asc(orderItems.createdAt), asc(orderItems.id)),
        db.select().from(shipments).where(inArray(shipments.orderId, orderIds)).orderBy(asc(shipments.createdAt)),
        db.select().from(orderEvents).where(inArray(orderEvents.orderId, orderIds)).orderBy(asc(orderEvents.createdAt), asc(orderEvents.id)),
        db.select().from(supportCases).where(inArray(supportCases.orderId, orderIds)).orderBy(asc(supportCases.createdAt)),
      ])
    : [[], [], [], []];
  const refById = new Map(orderRows.map((o) => [o.id, o.ref]));

  return {
    orders: orderRows.map((o) => ({
      ref: o.ref,
      placedAt: o.placedAt.toISOString(),
      status: o.status,
      paymentStatus: o.paymentStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      paymentMethod: o.paymentMethod,
      email: o.email,
      phone: o.phone,
      subtotalPaise: o.subtotalPaise,
      discountPaise: o.discountPaise,
      shippingPaise: o.shippingPaise,
      codFeePaise: o.codFeePaise,
      totalPaise: o.totalPaise,
      taxIncludedPaise: o.taxIncludedPaise,
      couponCode: o.couponCode,
      shippingAddress: o.shippingAddress,
      items: items
        .filter((i) => i.orderId === o.id)
        .map((i) => ({
          productName: i.productName,
          variantTitle: i.variantTitle,
          sku: i.sku,
          qty: i.qty,
          unitPricePaise: i.unitPricePaise,
          lineTotalPaise: i.lineTotalPaise,
        })),
      shipments: ships
        .filter((s) => s.orderId === o.id)
        .map((s) => ({
          courier: s.courier,
          awb: s.awb,
          trackingUrl: s.trackingUrl,
          status: s.status,
          shippedAt: iso(s.shippedAt),
          deliveredAt: iso(s.deliveredAt),
        })),
      // Only what the customer could already see on the order page.
      timeline: events
        .filter((e) => e.orderId === o.id && e.visibleToCustomer)
        .map((e) => ({ at: e.createdAt.toISOString(), event: e.type, note: e.note })),
    })),
    supportCases: cases.map((c) => ({
      orderRef: refById.get(c.orderId) ?? "",
      type: c.type,
      description: c.description,
      photos: c.photoPaths.length,
      status: c.status,
      resolution: c.resolution,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

/** Contact-form messages sent from this e-mail address (no staff notes or assignee). */
async function loadContactMessages(db: DbClient, email: string): Promise<ExportedContactMessage[]> {
  const rows = await db
    .select()
    .from(contactMessages)
    .where(sql`lower(${contactMessages.email}) = ${email.toLowerCase()}`)
    .orderBy(asc(contactMessages.createdAt));
  return rows.map((m) => ({ createdAt: m.createdAt.toISOString(), orderRef: m.orderRef, message: m.message }));
}

/** Coupon uses on the given orders. */
async function loadCouponRedemptions(db: DbClient, orderRows: OrderRow[]): Promise<ExportedCouponRedemption[]> {
  if (orderRows.length === 0) return [];
  const rows = await db
    .select({
      code: coupons.code,
      orderId: couponRedemptions.orderId,
      email: couponRedemptions.email,
      status: couponRedemptions.status,
      createdAt: couponRedemptions.createdAt,
    })
    .from(couponRedemptions)
    .innerJoin(coupons, eq(coupons.id, couponRedemptions.couponId))
    .where(inArray(couponRedemptions.orderId, orderRows.map((o) => o.id)))
    .orderBy(asc(couponRedemptions.createdAt));
  const refById = new Map(orderRows.map((o) => [o.id, o.ref]));
  return rows.map((r) => ({
    couponCode: r.code,
    orderRef: refById.get(r.orderId) ?? "",
    email: r.email,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Outbox rows about the given orders or addressed to the e-mail. */
function notificationsFor(orderIds: string[], email: string) {
  const toEmail = sql`lower(${notificationOutbox.to}) = ${email.toLowerCase()}`;
  return orderIds.length ? or(toEmail, inArray(notificationOutbox.orderId, orderIds)) : toEmail;
}

async function loadNotifications(db: DbClient, orderRows: OrderRow[], email: string): Promise<ExportedNotification[]> {
  const rows = await db
    .select()
    .from(notificationOutbox)
    .where(notificationsFor(orderRows.map((o) => o.id), email))
    .orderBy(asc(notificationOutbox.createdAt));
  return rows.map((n) => ({
    channel: n.channel,
    template: n.template,
    to: n.to,
    status: n.status,
    createdAt: n.createdAt.toISOString(),
    sentAt: iso(n.sentAt),
    payload: n.payload,
  }));
}

/** Everything IfOnli holds about the customer, as plain JSON (no secrets, no internal staff notes). */
export async function exportCustomerData(db: DbClient, userId: string): Promise<CustomerDataExport | null> {
  const [account] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!account) return null;
  const verifiedEmail = account.emailVerified ? account.email : null;

  const [profile] = await db.select().from(customerProfiles).where(eq(customerProfiles.userId, userId)).limit(1);
  const addressRows = await db.select().from(addresses).where(eq(addresses.userId, userId)).orderBy(asc(addresses.createdAt));
  const orderRows = await db.select().from(orders).where(ownedOrders(userId, verifiedEmail)).orderBy(asc(orders.placedAt));
  const bundle = await loadOrderBundle(db, orderRows);

  const wishlist = await db
    .select({ productId: wishlistItems.productId, createdAt: wishlistItems.createdAt, name: products.name })
    .from(wishlistItems)
    .leftJoin(products, eq(products.id, wishlistItems.productId))
    .where(eq(wishlistItems.userId, userId))
    .orderBy(asc(wishlistItems.createdAt));

  const messages = await loadContactMessages(db, account.email);
  const [redemptions, notifications] = await Promise.all([
    loadCouponRedemptions(db, orderRows),
    loadNotifications(db, orderRows, account.email),
  ]);

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    account: {
      id: account.id,
      name: account.name,
      email: account.email,
      emailVerified: account.emailVerified,
      createdAt: account.createdAt.toISOString(),
    },
    profile: { phone: profile?.phone ?? null, marketingOptIn: profile?.marketingOptIn ?? false },
    addresses: addressRows.map((a) => ({
      name: a.name,
      phone: a.phone,
      line1: a.line1,
      line2: a.line2,
      landmark: a.landmark,
      city: a.city,
      state: a.state,
      pincode: a.pincode,
      isDefault: a.isDefault,
      createdAt: a.createdAt.toISOString(),
    })),
    orders: bundle.orders,
    wishlist: wishlist.map((w) => ({ productId: w.productId, productName: w.name ?? null, savedAt: w.createdAt.toISOString() })),
    supportCases: bundle.supportCases,
    contactMessages: messages,
    couponRedemptions: redemptions,
    notifications,
  };
}

export interface GuestDataExport {
  formatVersion: number;
  exportedAt: string;
  /** A guest has no account: the data is whatever was typed at checkout and in the contact form. */
  guest: { email: string };
  orders: ExportedOrder[];
  supportCases: ExportedSupportCase[];
  contactMessages: ExportedContactMessage[];
  couponRedemptions: ExportedCouponRedemption[];
  notifications: ExportedNotification[];
}

/**
 * The data held about a buyer who checked out without an account: their orders (placed with this
 * e-mail and linked to no account), support cases and contact-form messages. Used by the admin
 * Customers module to answer a DPDP access request. Returns null when nothing is held.
 */
export async function exportGuestData(db: DbClient, email: string): Promise<GuestDataExport | null> {
  const normalized = email.trim().toLowerCase();
  const orderRows = await db
    .select()
    .from(orders)
    .where(and(isNull(orders.userId), sql`lower(${orders.email}) = ${normalized}`))
    .orderBy(asc(orders.placedAt));
  const messages = await loadContactMessages(db, normalized);
  if (orderRows.length === 0 && messages.length === 0) return null;
  const bundle = await loadOrderBundle(db, orderRows);
  const [redemptions, notifications] = await Promise.all([
    loadCouponRedemptions(db, orderRows),
    loadNotifications(db, orderRows, normalized),
  ]);
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    guest: { email: normalized },
    orders: bundle.orders,
    supportCases: bundle.supportCases,
    contactMessages: messages,
    couponRedemptions: redemptions,
    notifications,
  };
}

export interface DeletionActor {
  /** The customer themself (their own id) or a staff user. */
  id: string;
  ip?: string | null;
}

export type DeleteAccountResult =
  | { ok: true; ordersRetained: number }
  | { ok: false; code: "not_found" | "not_a_customer"; message: string };

/** Better Auth stores a pending sign-in code as `verification.identifier = "<type>-otp-<email>"`. */
function otpIdentifiers(email: string): string[] {
  const e = email.toLowerCase();
  return ["sign-in", "email-verification", "forget-password", "change-email"].map((t) => `${t}-otp-${e}`);
}

/** Deletes support photos from the private bucket; skipped when storage is not configured (local dev). */
export async function removeSupportPhotos(paths: string[]): Promise<void> {
  if (!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  for (let i = 0; i < paths.length; i += 100) await removeObjects("private", paths.slice(i, i + 100));
}

/**
 * Erases the customer's account (see the retention note at the top). One transaction, with an audit
 * row (`customer.delete`) that records counts only, never the e-mail. Admin-role users are refused:
 * staff accounts are removed from the admin Users screen, not through the customer flow.
 * The support photos are removed from storage after the database commit (`opts.removePhotos`
 * replaces that for tests); if storage fails the erasure still stands and the failure is logged.
 */
export async function deleteCustomerAccount(
  db: DbClient,
  userId: string,
  opts: { actor: DeletionActor; removePhotos?: (paths: string[]) => Promise<void> },
): Promise<DeleteAccountResult> {
  let photoPaths: string[] = [];
  const result = await db.transaction(async (tx): Promise<DeleteAccountResult> => {
    const [account] = await tx.select().from(user).where(eq(user.id, userId)).for("update");
    if (!account) return { ok: false, code: "not_found", message: "We couldn't find that account." };
    if (account.role !== "customer" || isAdminRole(account.role)) {
      return { ok: false, code: "not_a_customer", message: "Only customer accounts can be deleted here." };
    }

    const n = sql<number>`count(*)::int`;
    const [[addressCount], [wishlistCount], [sessionCount], [orderCount]] = await Promise.all([
      tx.select({ n }).from(addresses).where(eq(addresses.userId, userId)),
      tx.select({ n }).from(wishlistItems).where(eq(wishlistItems.userId, userId)),
      tx.select({ n }).from(session).where(eq(session.userId, userId)),
      tx.select({ n }).from(orders).where(eq(orders.userId, userId)),
    ]);
    const counts = {
      addresses: addressCount?.n ?? 0,
      wishlistItems: wishlistCount?.n ?? 0,
      sessions: sessionCount?.n ?? 0,
      ordersRetained: orderCount?.n ?? 0,
    };

    await writeAudit(tx, {
      actorId: opts.actor.id,
      action: "customer.delete",
      entity: "user",
      entityId: userId,
      diff: { by: opts.actor.id === userId ? "customer" : "staff", actorUserId: opts.actor.id, ...counts },
      ip: opts.actor.ip ?? null,
    });

    // Personal data that is not a tax or accounting record (see the retention note at the top).
    const mine = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(ownedOrders(userId, account.emailVerified ? account.email : null));
    const orderIds = mine.map((o) => o.id);
    if (orderIds.length > 0) {
      const cases = await tx
        .select({ photoPaths: supportCases.photoPaths })
        .from(supportCases)
        .where(inArray(supportCases.orderId, orderIds));
      photoPaths = cases.flatMap((c) => c.photoPaths);
      await tx
        .update(supportCases)
        .set({ description: SUPPORT_TEXT_REMOVED, photoPaths: [] })
        .where(inArray(supportCases.orderId, orderIds));
      await tx
        .update(couponRedemptions)
        .set({ email: sql`'deleted-' || ${couponRedemptions.id} || '@deleted.invalid'` })
        .where(inArray(couponRedemptions.orderId, orderIds));
    }
    await tx.delete(notificationOutbox).where(notificationsFor(orderIds, account.email));
    await tx.delete(contactMessages).where(sql`lower(${contactMessages.email}) = ${account.email.toLowerCase()}`);

    await tx.delete(verification).where(inArray(verification.identifier, otpIdentifiers(account.email)));
    await tx.delete(carts).where(eq(carts.userId, userId));
    // Cascades: session, account, two_factor, customer_profiles, addresses, wishlist_items.
    // `orders.user_id` and `carts.user_id` are ON DELETE SET NULL: orders stay as legal records.
    await tx.delete(user).where(eq(user.id, userId));
    return { ok: true, ordersRetained: counts.ordersRetained };
  });
  if (result.ok && photoPaths.length > 0) {
    try {
      await (opts.removePhotos ?? removeSupportPhotos)(photoPaths);
    } catch (e) {
      // The database erasure is done; the objects have random names and no longer link to anyone.
      console.error(`dpdp: ${photoPaths.length} support photos could not be removed`, e instanceof Error ? e.name : "unknown");
    }
  }
  return result;
}
