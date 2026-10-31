import "server-only";

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import {
  MAX_SAVED_ADDRESSES,
  accountAddressSchema,
  fieldErrorsOf,
  profileSchema,
  type SavedAddress,
} from "@/features/account/schema";
import { addresses, customerProfiles, user } from "@/server/db/schema";

import type { DbClient } from "./queries/shared";

/**
 * Customer profile and saved addresses (plan 10, Account). Every function takes the signed-in
 * customer's id from the session (never from the request body) and only ever touches that user's
 * rows. Expected failures are returned, not thrown, so Server Actions can show them next to the field.
 */

export type AccountResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "invalid" | "not_found" | "limit"; message: string; fieldErrors?: Record<string, string> };

/* ------------------------------------------------------------------------------------------ */
/* Profile                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export interface CustomerProfile {
  name: string;
  email: string;
  phone: string | null;
  marketingOptIn: boolean;
}

export async function getProfile(db: DbClient, userId: string): Promise<CustomerProfile | null> {
  const [row] = await db
    .select({
      name: user.name,
      email: user.email,
      phone: customerProfiles.phone,
      marketingOptIn: customerProfiles.marketingOptIn,
    })
    .from(user)
    .leftJoin(customerProfiles, eq(customerProfiles.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    marketingOptIn: row.marketingOptIn ?? false,
  };
}

/** Creates the `customer_profiles` row on first sign-in (no-op afterwards). */
export async function ensureProfile(db: DbClient, userId: string): Promise<void> {
  await db.insert(customerProfiles).values({ userId }).onConflictDoNothing({ target: customerProfiles.userId });
}

/** Saves name (on the auth user), phone and the marketing opt-in. */
export async function updateProfile(
  db: DbClient,
  userId: string,
  raw: unknown,
): Promise<AccountResult<CustomerProfile>> {
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const input = parsed.data;
  const found = await db.transaction(async (tx) => {
    const updated = await tx.update(user).set({ name: input.name }).where(eq(user.id, userId)).returning({ id: user.id });
    if (updated.length === 0) return false;
    await tx
      .insert(customerProfiles)
      .values({ userId, phone: input.phone ?? null, marketingOptIn: input.marketingOptIn })
      .onConflictDoUpdate({
        target: customerProfiles.userId,
        set: { phone: input.phone ?? null, marketingOptIn: input.marketingOptIn },
      });
    return true;
  });
  if (!found) return { ok: false, code: "not_found", message: "We couldn't find your account." };
  const profile = await getProfile(db, userId);
  return profile
    ? { ok: true, data: profile }
    : { ok: false, code: "not_found", message: "We couldn't find your account." };
}

/* ------------------------------------------------------------------------------------------ */
/* Addresses                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const toSaved = (row: typeof addresses.$inferSelect): SavedAddress => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  line1: row.line1,
  line2: row.line2,
  landmark: row.landmark,
  city: row.city,
  state: row.state,
  pincode: row.pincode,
  isDefault: row.isDefault,
});

/** Default first, then newest. */
export async function listAddresses(db: DbClient, userId: string): Promise<SavedAddress[]> {
  const rows = await db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, userId))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt), asc(addresses.id));
  return rows.map(toSaved);
}

/** Takes the "default" flag away from every other address of the user (the unique index allows one). */
async function clearOtherDefaults(tx: DbClient, userId: string, keepId: string | null): Promise<void> {
  await tx
    .update(addresses)
    .set({ isDefault: false })
    .where(
      and(eq(addresses.userId, userId), eq(addresses.isDefault, true), keepId ? ne(addresses.id, keepId) : undefined),
    );
}

/**
 * Adds an address. The first address is always the default; asking for a default moves the flag.
 * At most `MAX_SAVED_ADDRESSES` per customer.
 */
export async function createAddress(
  db: DbClient,
  userId: string,
  raw: unknown,
): Promise<AccountResult<SavedAddress>> {
  const parsed = accountAddressSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const input = parsed.data;
  return db.transaction(async (tx): Promise<AccountResult<SavedAddress>> => {
    // Serialise a customer's address writes so the count and the default flag cannot race.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`addresses:${userId}`}))`);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(addresses)
      .where(eq(addresses.userId, userId));
    const existing = count?.n ?? 0;
    if (existing >= MAX_SAVED_ADDRESSES) {
      return {
        ok: false,
        code: "limit",
        message: `You can save up to ${MAX_SAVED_ADDRESSES} addresses. Remove one to add another.`,
      };
    }
    const makeDefault = input.isDefault || existing === 0;
    if (makeDefault) await clearOtherDefaults(tx, userId, null);
    const [row] = await tx
      .insert(addresses)
      .values({
        userId,
        name: input.name,
        phone: input.phone,
        line1: input.line1,
        line2: input.line2 ?? null,
        landmark: input.landmark ?? null,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        isDefault: makeDefault,
      })
      .returning();
    return { ok: true, data: toSaved(row as typeof addresses.$inferSelect) };
  });
}

export async function updateAddress(
  db: DbClient,
  userId: string,
  addressId: string,
  raw: unknown,
): Promise<AccountResult<SavedAddress>> {
  const parsed = accountAddressSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const input = parsed.data;
  return db.transaction(async (tx): Promise<AccountResult<SavedAddress>> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`addresses:${userId}`}))`);
    const [current] = await tx
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .for("update");
    if (!current) return { ok: false, code: "not_found", message: "We couldn't find that address." };
    // An address that is the default stays the default (use "make default" on another one to move it).
    const makeDefault = input.isDefault || current.isDefault;
    if (makeDefault) await clearOtherDefaults(tx, userId, addressId);
    const [row] = await tx
      .update(addresses)
      .set({
        name: input.name,
        phone: input.phone,
        line1: input.line1,
        line2: input.line2 ?? null,
        landmark: input.landmark ?? null,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        isDefault: makeDefault,
      })
      .where(eq(addresses.id, addressId))
      .returning();
    return { ok: true, data: toSaved(row as typeof addresses.$inferSelect) };
  });
}

export async function setDefaultAddress(
  db: DbClient,
  userId: string,
  addressId: string,
): Promise<AccountResult<SavedAddress>> {
  return db.transaction(async (tx): Promise<AccountResult<SavedAddress>> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`addresses:${userId}`}))`);
    const [current] = await tx
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .for("update");
    if (!current) return { ok: false, code: "not_found", message: "We couldn't find that address." };
    await clearOtherDefaults(tx, userId, addressId);
    const [row] = await tx
      .update(addresses)
      .set({ isDefault: true })
      .where(eq(addresses.id, addressId))
      .returning();
    return { ok: true, data: toSaved(row as typeof addresses.$inferSelect) };
  });
}

/** Removes an address. If it was the default, the most recently added remaining one takes over. */
export async function deleteAddress(
  db: DbClient,
  userId: string,
  addressId: string,
): Promise<AccountResult<{ id: string }>> {
  return db.transaction(async (tx): Promise<AccountResult<{ id: string }>> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`addresses:${userId}`}))`);
    const removed = await tx
      .delete(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .returning();
    const gone = removed[0];
    if (!gone) return { ok: false, code: "not_found", message: "We couldn't find that address." };
    if (gone.isDefault) {
      const [next] = await tx
        .select({ id: addresses.id })
        .from(addresses)
        .where(eq(addresses.userId, userId))
        .orderBy(desc(addresses.createdAt), asc(addresses.id))
        .limit(1);
      if (next) await tx.update(addresses).set({ isDefault: true }).where(eq(addresses.id, next.id));
    }
    return { ok: true, data: { id: addressId } };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Checkout prefill                                                                           */
/* ------------------------------------------------------------------------------------------ */

export interface CheckoutPrefill {
  /** Saved addresses, default first. */
  addresses: SavedAddress[];
  /** Phone from the profile, used when no address carries one. */
  phone: string | null;
}

/** What the checkout form starts with for a signed-in customer. */
export async function loadCheckoutPrefill(db: DbClient, userId: string): Promise<CheckoutPrefill> {
  const [list, profile] = await Promise.all([listAddresses(db, userId), getProfile(db, userId)]);
  return { addresses: list, phone: profile?.phone ?? null };
}
