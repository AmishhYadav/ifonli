import "server-only";

import { and, asc, count, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";

import {
  accountAddressSchema,
  MAX_ADDRESSES,
  type AccountAddressInput,
  type ProfileValues,
} from "@/features/account/schema";
import { WISHLIST_MAX_ITEMS, type WishlistEntry } from "@/features/wishlist/list";
import {
  account,
  addresses,
  carts,
  customerProfiles,
  orderItems,
  orders,
  products,
  session,
  states,
  user,
  verification,
  wishlistItems,
} from "@/server/db/schema";
import { customerStatusLabel, normalizeOrderRef } from "@/server/domain";
import { isAdminRole } from "@/server/auth/permissions";

import { writeAudit } from "./audit";
import type { DbClient } from "./queries/shared";

/**
 * Customer account data (plan 7.12): profile, address book, order history, account wishlist,
 * data export and deletion. Every function takes the owner's `userId` and scopes by it; the caller
 * (a Server Action, page or route handler) gets the id from the verified session, never from input.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Serialises writers of one customer's address book (limit check + single default). */
async function lockCustomer(tx: DbClient, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`account:${userId}`}, 0))`);
}

/* ------------------------------------------------------------------------------------------ */
/* Profile                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export interface CustomerProfile {
  email: string;
  name: string;
  phone: string | null;
  marketingOptIn: boolean;
  createdAt: Date;
}

export async function getCustomerProfile(
  db: DbClient,
  userId: string,
): Promise<CustomerProfile | null> {
  const [row] = await db
    .select({
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      phone: customerProfiles.phone,
      marketingOptIn: customerProfiles.marketingOptIn,
    })
    .from(user)
    .leftJoin(customerProfiles, eq(customerProfiles.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    email: row.email,
    name: row.name,
    phone: row.phone ?? null,
    marketingOptIn: row.marketingOptIn ?? false,
    createdAt: row.createdAt,
  };
}

export async function updateCustomerProfile(
  db: DbClient,
  userId: string,
  input: ProfileValues,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(user).set({ name: input.name }).where(eq(user.id, userId));
    await tx
      .insert(customerProfiles)
      .values({ userId, phone: input.phone, marketingOptIn: input.marketingOptIn })
      .onConflictDoUpdate({
        target: customerProfiles.userId,
        set: { phone: input.phone, marketingOptIn: input.marketingOptIn, updatedAt: new Date() },
      });
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Addresses                                                                                  */
/* ------------------------------------------------------------------------------------------ */

export interface AddressRecord {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export type AddressResult =
  | { ok: true; address: AddressRecord }
  | { ok: false; code: "limit_reached" | "not_found" | "invalid_state"; message: string };

const ADDRESS_COLUMNS = {
  id: addresses.id,
  name: addresses.name,
  phone: addresses.phone,
  line1: addresses.line1,
  line2: addresses.line2,
  landmark: addresses.landmark,
  city: addresses.city,
  state: addresses.state,
  pincode: addresses.pincode,
  isDefault: addresses.isDefault,
};

/** Default first, then newest. */
export async function listAddresses(db: DbClient, userId: string): Promise<AddressRecord[]> {
  return db
    .select(ADDRESS_COLUMNS)
    .from(addresses)
    .where(eq(addresses.userId, userId))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt), asc(addresses.id));
}

export async function getDefaultAddress(
  db: DbClient,
  userId: string,
): Promise<AddressRecord | null> {
  const [row] = await db
    .select(ADDRESS_COLUMNS)
    .from(addresses)
    .where(and(eq(addresses.userId, userId), eq(addresses.isDefault, true)))
    .limit(1);
  return row ?? null;
}

/** The canonical spelling of a state / UT name from the reference table (case-insensitive), or null. */
async function canonicalState(db: DbClient, name: string): Promise<string | null> {
  const [row] = await db
    .select({ name: states.name })
    .from(states)
    .where(sql`lower(${states.name}) = lower(${name})`)
    .limit(1);
  return row?.name ?? null;
}

export async function listStateNames(db: DbClient): Promise<string[]> {
  const rows = await db.select({ name: states.name }).from(states).orderBy(asc(states.name));
  return rows.map((r) => r.name);
}

const INVALID_STATE = {
  ok: false,
  code: "invalid_state",
  message: "Choose your state from the list",
} as const;

/** Validates `input` with `accountAddressSchema` (throws on bad input). The first address always becomes the default. */
export async function createAddress(
  db: DbClient,
  userId: string,
  input: AccountAddressInput,
): Promise<AddressResult> {
  const values = accountAddressSchema.parse(input);
  return db.transaction(async (tx): Promise<AddressResult> => {
    await lockCustomer(tx, userId);
    const state = await canonicalState(tx, values.state);
    if (!state) return INVALID_STATE;
    const [countRow] = await tx
      .select({ n: count() })
      .from(addresses)
      .where(eq(addresses.userId, userId));
    const n = countRow?.n ?? 0;
    if (n >= MAX_ADDRESSES) {
      return {
        ok: false,
        code: "limit_reached",
        message: `You can save up to ${MAX_ADDRESSES} addresses. Remove one to add another.`,
      };
    }
    const isDefault = n === 0 || values.isDefault === true;
    if (isDefault) {
      await tx
        .update(addresses)
        .set({ isDefault: false })
        .where(and(eq(addresses.userId, userId), eq(addresses.isDefault, true)));
    }
    const [row] = await tx
      .insert(addresses)
      .values({
        userId,
        name: values.name,
        phone: values.phone,
        line1: values.line1,
        line2: values.line2 ?? null,
        landmark: values.landmark ?? null,
        city: values.city,
        state,
        pincode: values.pincode,
        isDefault,
      })
      .returning(ADDRESS_COLUMNS);
    return { ok: true, address: row! };
  });
}

/** Edits an address the user owns. `isDefault: true` makes it the default; omitting it keeps the current flag. */
export async function updateAddress(
  db: DbClient,
  userId: string,
  addressId: string,
  input: AccountAddressInput,
): Promise<AddressResult> {
  const values = accountAddressSchema.parse(input);
  return db.transaction(async (tx): Promise<AddressResult> => {
    await lockCustomer(tx, userId);
    const existing = UUID_RE.test(addressId)
      ? (
          await tx
            .select({ id: addresses.id, isDefault: addresses.isDefault })
            .from(addresses)
            .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
            .limit(1)
        )[0]
      : undefined;
    if (!existing)
      return { ok: false, code: "not_found", message: "We couldn't find that address." };
    const state = await canonicalState(tx, values.state);
    if (!state) return INVALID_STATE;
    const isDefault = values.isDefault === true || existing.isDefault;
    if (isDefault && !existing.isDefault) {
      await tx
        .update(addresses)
        .set({ isDefault: false })
        .where(and(eq(addresses.userId, userId), eq(addresses.isDefault, true)));
    }
    const [row] = await tx
      .update(addresses)
      .set({
        name: values.name,
        phone: values.phone,
        line1: values.line1,
        line2: values.line2 ?? null,
        landmark: values.landmark ?? null,
        city: values.city,
        state,
        pincode: values.pincode,
        isDefault,
      })
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .returning(ADDRESS_COLUMNS);
    return { ok: true, address: row! };
  });
}

export async function setDefaultAddress(
  db: DbClient,
  userId: string,
  addressId: string,
): Promise<AddressResult> {
  return db.transaction(async (tx): Promise<AddressResult> => {
    await lockCustomer(tx, userId);
    if (!UUID_RE.test(addressId)) {
      return { ok: false, code: "not_found", message: "We couldn't find that address." };
    }
    const [target] = await tx
      .select({ id: addresses.id })
      .from(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .limit(1);
    if (!target) return { ok: false, code: "not_found", message: "We couldn't find that address." };
    await tx
      .update(addresses)
      .set({ isDefault: false })
      .where(
        and(
          eq(addresses.userId, userId),
          eq(addresses.isDefault, true),
          ne(addresses.id, addressId),
        ),
      );
    const [row] = await tx
      .update(addresses)
      .set({ isDefault: true })
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .returning(ADDRESS_COLUMNS);
    return { ok: true, address: row! };
  });
}

/** Removes an address the user owns. If it was the default, the most recently added one takes over. */
export async function deleteAddress(
  db: DbClient,
  userId: string,
  addressId: string,
): Promise<boolean> {
  if (!UUID_RE.test(addressId)) return false;
  return db.transaction(async (tx) => {
    await lockCustomer(tx, userId);
    const [removed] = await tx
      .delete(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .returning({ isDefault: addresses.isDefault });
    if (!removed) return false;
    if (removed.isDefault) {
      const [next] = await tx
        .select({ id: addresses.id })
        .from(addresses)
        .where(eq(addresses.userId, userId))
        .orderBy(desc(addresses.createdAt), asc(addresses.id))
        .limit(1);
      if (next)
        await tx.update(addresses).set({ isDefault: true }).where(eq(addresses.id, next.id));
    }
    return true;
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Orders                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export interface OrderSummary {
  ref: string;
  statusLabel: ReturnType<typeof customerStatusLabel>;
  placedAt: Date;
  totalPaise: number;
  itemCount: number;
  /** First line items, for the list row ("Heart charm, Star sticker"). */
  itemNames: string[];
  imagePath: string | null;
}

export interface OrdersPage {
  orders: OrderSummary[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * The customer's orders, newest first. Orders that were never completed (`expired`, abandoned
 * `pending_payment` past their hold) are listed too: the status label says what happened.
 */
export async function listCustomerOrders(
  db: DbClient,
  userId: string,
  opts: { page: number; pageSize: number },
): Promise<OrdersPage> {
  const [countRow] = await db.select({ n: count() }).from(orders).where(eq(orders.userId, userId));
  const n = countRow?.n ?? 0;
  const pageCount = Math.max(1, Math.ceil(n / opts.pageSize));
  const page = Math.min(Math.max(1, opts.page), pageCount);
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(opts.pageSize)
    .offset((page - 1) * opts.pageSize);

  const items =
    rows.length === 0
      ? []
      : await db
          .select({
            orderId: orderItems.orderId,
            name: orderItems.productName,
            qty: orderItems.qty,
            imagePath: orderItems.imagePath,
          })
          .from(orderItems)
          .where(
            inArray(
              orderItems.orderId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
  const byOrder = new Map<string, typeof items>();
  for (const item of items) byOrder.set(item.orderId, [...(byOrder.get(item.orderId) ?? []), item]);

  return {
    orders: rows.map((o) => {
      const lines = byOrder.get(o.id) ?? [];
      return {
        ref: o.ref,
        statusLabel: customerStatusLabel(o),
        placedAt: o.placedAt,
        totalPaise: o.totalPaise,
        itemCount: lines.reduce((sum, l) => sum + l.qty, 0),
        itemNames: lines.slice(0, 3).map((l) => l.name),
        imagePath: lines.find((l) => l.imagePath)?.imagePath ?? null,
      };
    }),
    total: n,
    page,
    pageCount,
  };
}

/** Id of an order the user owns, for routes that stream a file for it (invoice). */
export async function findOwnedOrderId(
  db: DbClient,
  userId: string,
  ref: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.ref, normalizeOrderRef(ref))))
    .limit(1);
  return row?.id ?? null;
}

/* ------------------------------------------------------------------------------------------ */
/* Account wishlist (the server half of the `WishlistSync` seam)                              */
/* ------------------------------------------------------------------------------------------ */

export async function getAccountWishlist(db: DbClient, userId: string): Promise<WishlistEntry[]> {
  const rows = await db
    .select({ id: wishlistItems.productId, createdAt: wishlistItems.createdAt })
    .from(wishlistItems)
    .where(eq(wishlistItems.userId, userId))
    .orderBy(desc(wishlistItems.createdAt))
    .limit(WISHLIST_MAX_ITEMS);
  return rows.map((r) => ({ id: r.id, addedAt: r.createdAt.getTime() }));
}

/**
 * Makes the account list exactly `entries` (the device's merged list): ids that are not products are
 * dropped, rows for products no longer listed are deleted, new ones are inserted with the time they
 * were saved on the device, existing ones keep their row.
 */
export async function replaceAccountWishlist(
  db: DbClient,
  userId: string,
  entries: readonly WishlistEntry[],
  now: Date = new Date(),
): Promise<WishlistEntry[]> {
  const unique = new Map<string, WishlistEntry>();
  for (const e of entries) if (UUID_RE.test(e.id) && !unique.has(e.id)) unique.set(e.id, e);
  const wanted = [...unique.values()].slice(0, WISHLIST_MAX_ITEMS);

  return db.transaction(async (tx) => {
    await lockCustomer(tx, userId);
    const known = wanted.length
      ? new Set(
          (
            await tx
              .select({ id: products.id })
              .from(products)
              .where(
                inArray(
                  products.id,
                  wanted.map((e) => e.id),
                ),
              )
          ).map((r) => r.id),
        )
      : new Set<string>();
    const keep = wanted.filter((e) => known.has(e.id));

    if (keep.length === 0) {
      await tx.delete(wishlistItems).where(eq(wishlistItems.userId, userId));
      return [];
    }
    await tx.delete(wishlistItems).where(
      and(
        eq(wishlistItems.userId, userId),
        notInArray(
          wishlistItems.productId,
          keep.map((e) => e.id),
        ),
      ),
    );
    await tx
      .insert(wishlistItems)
      .values(
        keep.map((e) => ({
          userId,
          productId: e.id,
          createdAt: e.addedAt > 0 && e.addedAt <= now.getTime() ? new Date(e.addedAt) : now,
        })),
      )
      .onConflictDoNothing();
    return getAccountWishlist(tx, userId);
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Export                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export interface CustomerDataExport {
  exportedAt: string;
  account: { email: string; name: string; createdAt: string };
  profile: { phone: string | null; marketingOptIn: boolean };
  addresses: Omit<AddressRecord, "id">[];
  orders: unknown[];
  wishlist: { productSlug: string; productName: string; savedAt: string }[];
}

/**
 * Everything held about the customer in a portable shape (DPDP right to access). Internal ids
 * (user, address, order, product ids) are left out: orders are identified by their public reference
 * and wishlist items by product slug, so the file cannot be used to reach anyone else's data.
 */
export async function exportCustomerData(
  db: DbClient,
  userId: string,
  now: Date = new Date(),
): Promise<CustomerDataExport | null> {
  const profile = await getCustomerProfile(db, userId);
  if (!profile) return null;
  const [addressRows, orderRows, wishlistRows] = await Promise.all([
    listAddresses(db, userId),
    db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.placedAt)),
    db
      .select({ slug: products.slug, name: products.name, savedAt: wishlistItems.createdAt })
      .from(wishlistItems)
      .innerJoin(products, eq(products.id, wishlistItems.productId))
      .where(eq(wishlistItems.userId, userId))
      .orderBy(desc(wishlistItems.createdAt)),
  ]);
  const itemRows = orderRows.length
    ? await db
        .select()
        .from(orderItems)
        .where(
          inArray(
            orderItems.orderId,
            orderRows.map((o) => o.id),
          ),
        )
        .orderBy(asc(orderItems.createdAt), asc(orderItems.id))
    : [];

  return {
    exportedAt: now.toISOString(),
    account: {
      email: profile.email,
      name: profile.name,
      createdAt: profile.createdAt.toISOString(),
    },
    profile: { phone: profile.phone, marketingOptIn: profile.marketingOptIn },
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
    })),
    orders: orderRows.map((o) => ({
      reference: o.ref,
      placedAt: o.placedAt.toISOString(),
      status: customerStatusLabel(o),
      paymentMethod: o.paymentMethod,
      email: o.email,
      phone: o.phone,
      shippingAddress: o.shippingAddress,
      subtotalPaise: o.subtotalPaise,
      discountPaise: o.discountPaise,
      shippingPaise: o.shippingPaise,
      codFeePaise: o.codFeePaise,
      totalPaise: o.totalPaise,
      couponCode: o.couponCode,
      items: itemRows
        .filter((i) => i.orderId === o.id)
        .map((i) => ({
          product: i.productName,
          variant: i.variantTitle,
          sku: i.sku,
          quantity: i.qty,
          unitPricePaise: i.unitPricePaise,
          lineTotalPaise: i.lineTotalPaise,
        })),
    })),
    wishlist: wishlistRows.map((w) => ({
      productSlug: w.slug,
      productName: w.name,
      savedAt: w.savedAt.toISOString(),
    })),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Deletion                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export type DeleteAccountResult =
  { ok: true; ordersDetached: number } | { ok: false; code: "not_found" | "not_a_customer" };

/**
 * DPDP erasure (D-AUTH-3). In one transaction:
 *  - addresses, wishlist, carts (and their items), sessions, linked accounts and pending sign-in
 *    codes are hard-deleted;
 *  - orders are kept for tax and consumer-law retention but detached (`user_id` NULL); they keep the
 *    e-mail and shipping snapshot the invoice needs;
 *  - the `user` row is anonymised rather than deleted (unique placeholder e-mail, no name, banned),
 *    so audit rows that point at it stay valid and the real e-mail address is free to sign up again;
 *  - `customer_profiles` is reduced to a tombstone (`phone` cleared, `deleted_at` set);
 *  - an `admin_audit_log` row records that the erasure happened (no personal data in it).
 * Admin-role accounts are refused: staff are removed through the admin tools.
 */
export async function deleteCustomerAccount(
  db: DbClient,
  userId: string,
  opts: { ip?: string | null; now?: Date } = {},
): Promise<DeleteAccountResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx): Promise<DeleteAccountResult> => {
    await lockCustomer(tx, userId);
    const [row] = await tx
      .select({ id: user.id, email: user.email, role: user.role })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    if (!row) return { ok: false, code: "not_found" };
    if (isAdminRole(row.role)) return { ok: false, code: "not_a_customer" };

    const detached = await tx
      .update(orders)
      .set({ userId: null })
      .where(eq(orders.userId, userId))
      .returning({ id: orders.id });
    await tx.delete(addresses).where(eq(addresses.userId, userId));
    await tx.delete(wishlistItems).where(eq(wishlistItems.userId, userId));
    await tx.delete(carts).where(eq(carts.userId, userId));
    await tx.delete(session).where(eq(session.userId, userId));
    await tx.delete(account).where(eq(account.userId, userId));
    await tx
      .delete(verification)
      .where(sql`position(lower(${row.email}) in lower(${verification.identifier})) > 0`);

    await tx
      .update(user)
      .set({
        email: `deleted-${userId}@deleted.invalid`,
        name: "Deleted customer",
        image: null,
        emailVerified: false,
        banned: true,
        banReason: "account_deleted",
        updatedAt: now,
      })
      .where(eq(user.id, userId));
    await tx
      .insert(customerProfiles)
      .values({ userId, phone: null, marketingOptIn: false, deletedAt: now })
      .onConflictDoUpdate({
        target: customerProfiles.userId,
        set: { phone: null, marketingOptIn: false, deletedAt: now, updatedAt: now },
      });
    await writeAudit(tx, {
      actorId: userId,
      action: "customer.account_deleted",
      entity: "user",
      entityId: userId,
      diff: { ordersDetached: detached.length },
      ip: opts.ip ?? null,
    });
    return { ok: true, ordersDetached: detached.length };
  });
}
