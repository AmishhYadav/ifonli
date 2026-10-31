"use server";

import { unstable_rethrow } from "next/navigation";

import { keyDigest } from "@/features/cart/request";
import { getOptionalCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { getAccountWishlist, replaceAccountWishlist } from "@/server/services/wishlist";

import type { WishlistEntry } from "./list";

/**
 * Server Actions behind the `WishlistSync` seam (D-20). Every call re-reads the session: the hint cookie
 * that makes the browser call these is not trusted, and a guest or staff session simply gets
 * `signedIn: false` and no data.
 */

export type WishlistPullResult =
  | { signedIn: false }
  | { signedIn: true; userId: string; entries: WishlistEntry[] };

export type WishlistPushResult =
  | { signedIn: false }
  | { signedIn: true; entries: WishlistEntry[] }
  | { signedIn: true; error: "rate_limited" | "server_error" };

/** The signed-in customer's saved products. */
export async function pullWishlistAction(): Promise<WishlistPullResult> {
  try {
    const customer = await getOptionalCustomer();
    if (!customer) return { signedIn: false };
    return {
      signedIn: true,
      userId: customer.user.id,
      entries: await getAccountWishlist(getDb(), customer.user.id),
    };
  } catch (e) {
    unstable_rethrow(e);
    console.error("pullWishlistAction failed", e instanceof Error ? e.message : "unknown");
    return { signedIn: false };
  }
}

/** Replaces the account list with the device's (already merged) list. */
export async function pushWishlistAction(entries: unknown): Promise<WishlistPushResult> {
  try {
    const customer = await getOptionalCustomer();
    if (!customer) return { signedIn: false };
    const db = getDb();
    const limit = await consumeRateLimit(db, `wishlist-sync:${keyDigest(customer.user.id)}`, {
      limit: 120,
      windowSeconds: 600,
    });
    if (!limit.allowed) return { signedIn: true, error: "rate_limited" };
    return { signedIn: true, entries: await replaceAccountWishlist(db, customer.user.id, entries) };
  } catch (e) {
    unstable_rethrow(e);
    console.error("pushWishlistAction failed", e instanceof Error ? e.message : "unknown");
    return { signedIn: true, error: "server_error" };
  }
}
