import "server-only";

import { desc, eq, inArray, notInArray, and } from "drizzle-orm";

import { WISHLIST_MAX_ITEMS, mergeWishlists, parseWishlist, type WishlistEntry } from "@/features/wishlist/list";
import { products, wishlistItems } from "@/server/db/schema";

import type { DbClient } from "./queries/shared";

/**
 * Account wishlist (plan D-20): the server half of the `WishlistSync` seam. The device keeps the
 * list in `localStorage`; a signed-in customer's list lives in `wishlist_items`. Entries are
 * products (not variants), newest first, at most `WISHLIST_MAX_ITEMS` (the oldest fall off).
 */

type Row = { productId: string; createdAt: Date };

const toEntry = (row: Row): WishlistEntry => ({ id: row.productId, addedAt: row.createdAt.getTime() });

/** The customer's saved products, newest first. */
export async function getAccountWishlist(db: DbClient, userId: string): Promise<WishlistEntry[]> {
  const rows = await db
    .select({ productId: wishlistItems.productId, createdAt: wishlistItems.createdAt })
    .from(wishlistItems)
    .where(eq(wishlistItems.userId, userId))
    .orderBy(desc(wishlistItems.createdAt), desc(wishlistItems.productId))
    .limit(WISHLIST_MAX_ITEMS);
  return rows.map(toEntry);
}

/** Cleans input from the device: valid unique ids, finite times, newest first, capped. */
export function normalizeEntries(raw: unknown): WishlistEntry[] {
  return parseWishlist(JSON.stringify(Array.isArray(raw) ? raw : []));
}

/**
 * Makes the account list equal to `raw` (the device's merged list): rows not in it are removed,
 * missing ones added with the device's save time. Ids that are not real products are dropped, so a
 * stale or forged id can never break the write. Returns the stored list.
 */
export async function replaceAccountWishlist(
  db: DbClient,
  userId: string,
  raw: unknown,
): Promise<WishlistEntry[]> {
  const wanted = normalizeEntries(raw);
  return db.transaction(async (tx) => {
    const known = wanted.length
      ? await tx
          .select({ id: products.id })
          .from(products)
          .where(
            inArray(
              products.id,
              wanted.map((e) => e.id),
            ),
          )
      : [];
    const knownIds = new Set(known.map((p) => p.id));
    const keep = wanted.filter((e) => knownIds.has(e.id));

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
          createdAt: new Date(e.addedAt > 0 ? e.addedAt : Date.now()),
        })),
      )
      .onConflictDoNothing({ target: [wishlistItems.userId, wishlistItems.productId] });
    return getAccountWishlist(tx, userId);
  });
}

/**
 * Union of the device list and the account list (an id in both keeps its earliest save time), stored
 * and returned. This is the one-time merge on first sign-in from a device; afterwards the account
 * list is the source of truth and the device follows it.
 */
export async function mergeIntoAccountWishlist(
  db: DbClient,
  userId: string,
  raw: unknown,
): Promise<WishlistEntry[]> {
  const current = await getAccountWishlist(db, userId);
  const merged = mergeWishlists(current, normalizeEntries(raw));
  return replaceAccountWishlist(db, userId, merged);
}
