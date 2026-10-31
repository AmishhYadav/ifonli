import "server-only";

import { asc, eq, inArray, or, sql } from "drizzle-orm";

import { isAdminRole } from "@/server/auth/permissions";
import {
  addresses,
  carts,
  contactMessages,
  customerProfiles,
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

import { writeAudit } from "./audit";
import type { DbClient } from "./queries/shared";

/**
 * DPDP Act 2023 / Rules 2025 (plan 3): "download my data" and "delete my account". Reusable by the
 * customer account page and, later, the admin Customers module (pass the staff member as `actor`).
 *
 * Retention (documented in docs/DECISIONS.md, D-DPDP-1):
 *  - deleted: the login (user, sessions, accounts), profile, saved addresses, wishlist, open carts,
 *    unused sign-in codes;
 *  - kept: orders and their lines, events, shipments, invoices and refunds, which hold the name,
 *    address, e-mail and phone the customer typed at checkout. They are tax and accounting records
 *    and a consumer-protection evidence trail; `orders.user_id` is set to NULL by the foreign key, so
 *    they no longer belong to any account. Support cases (and their photos) stay with their order;
 *    contact-form messages are not touched by account deletion.
 */

export const EXPORT_FORMAT_VERSION = 1;

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
  orders: {
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
  }[];
  wishlist: { productId: string; productName: string | null; savedAt: string }[];
  supportCases: {
    orderRef: string;
    type: string;
    description: string;
    photos: number;
    status: string;
    resolution: string | null;
    createdAt: string;
  }[];
  contactMessages: { createdAt: string; orderRef: string | null; message: string }[];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Orders that belong to the customer: linked to the account, or placed with its verified e-mail. */
function ownedOrders(userId: string, verifiedEmail: string | null) {
  const byUser = eq(orders.userId, userId);
  return verifiedEmail ? or(byUser, sql`lower(${orders.email}) = ${verifiedEmail.toLowerCase()}`) : byUser;
}

/** Everything IfOnli holds about the customer, as plain JSON (no secrets, no internal staff notes). */
export async function exportCustomerData(db: DbClient, userId: string): Promise<CustomerDataExport | null> {
  const [account] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!account) return null;
  const verifiedEmail = account.emailVerified ? account.email : null;

  const [profile] = await db.select().from(customerProfiles).where(eq(customerProfiles.userId, userId)).limit(1);
  const addressRows = await db.select().from(addresses).where(eq(addresses.userId, userId)).orderBy(asc(addresses.createdAt));
  const orderRows = await db.select().from(orders).where(ownedOrders(userId, verifiedEmail)).orderBy(asc(orders.placedAt));
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

  const wishlist = await db
    .select({ productId: wishlistItems.productId, createdAt: wishlistItems.createdAt, name: products.name })
    .from(wishlistItems)
    .leftJoin(products, eq(products.id, wishlistItems.productId))
    .where(eq(wishlistItems.userId, userId))
    .orderBy(asc(wishlistItems.createdAt));

  const messages = await db
    .select()
    .from(contactMessages)
    .where(sql`lower(${contactMessages.email}) = ${account.email.toLowerCase()}`)
    .orderBy(asc(contactMessages.createdAt));

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
    wishlist: wishlist.map((w) => ({ productId: w.productId, productName: w.name ?? null, savedAt: w.createdAt.toISOString() })),
    supportCases: cases.map((c) => ({
      orderRef: refById.get(c.orderId) ?? "",
      type: c.type,
      description: c.description,
      photos: c.photoPaths.length,
      status: c.status,
      resolution: c.resolution,
      createdAt: c.createdAt.toISOString(),
    })),
    contactMessages: messages.map((m) => ({
      createdAt: m.createdAt.toISOString(),
      orderRef: m.orderRef,
      message: m.message,
    })),
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

/**
 * Erases the customer's account (see the retention note at the top). One transaction, with an audit
 * row (`customer.delete`) that records counts only, never the e-mail. Admin-role users are refused:
 * staff accounts are removed from the admin Users screen, not through the customer flow.
 */
export async function deleteCustomerAccount(
  db: DbClient,
  userId: string,
  opts: { actor: DeletionActor },
): Promise<DeleteAccountResult> {
  return db.transaction(async (tx): Promise<DeleteAccountResult> => {
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

    await tx.delete(verification).where(inArray(verification.identifier, otpIdentifiers(account.email)));
    await tx.delete(carts).where(eq(carts.userId, userId));
    // Cascades: session, account, two_factor, customer_profiles, addresses, wishlist_items.
    // `orders.user_id` and `carts.user_id` are ON DELETE SET NULL: orders stay as legal records.
    await tx.delete(user).where(eq(user.id, userId));
    return { ok: true, ordersRetained: counts.ordersRetained };
  });
}
