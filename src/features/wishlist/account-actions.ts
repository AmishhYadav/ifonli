"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getAccountWishlist, replaceAccountWishlist } from "@/server/services/accounts";

import { WISHLIST_MAX_ITEMS, type WishlistEntry } from "./list";

/**
 * Server half of the `WishlistSync` seam (see `sync.ts`). `signedIn: false` means the session is gone
 * (expired, signed out elsewhere, deleted account): the client then goes back to device-only.
 */
export type AccountWishlistResult =
  { ok: true; entries: WishlistEntry[] } | { ok: false; signedIn: boolean };

const entriesSchema = z
  .array(z.object({ id: z.uuid(), addedAt: z.number().finite().nonnegative() }))
  .max(WISHLIST_MAX_ITEMS);

async function customerId(): Promise<string | null> {
  try {
    return (await requireCustomer({ denied: "throw" })).user.id;
  } catch (e) {
    unstable_rethrow(e);
    return null;
  }
}

export async function pullAccountWishlist(): Promise<AccountWishlistResult> {
  const userId = await customerId();
  if (!userId) return { ok: false, signedIn: false };
  try {
    return { ok: true, entries: await getAccountWishlist(getDb(), userId) };
  } catch (e) {
    unstable_rethrow(e);
    console.error("pullAccountWishlist failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, signedIn: true };
  }
}

/** Replaces the account list with the device's list (already merged with the account's after sign-in). */
export async function pushAccountWishlist(input: unknown): Promise<AccountWishlistResult> {
  const userId = await customerId();
  if (!userId) return { ok: false, signedIn: false };
  const parsed = entriesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, signedIn: true };
  try {
    return { ok: true, entries: await replaceAccountWishlist(getDb(), userId, parsed.data) };
  } catch (e) {
    unstable_rethrow(e);
    console.error("pushAccountWishlist failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, signedIn: true };
  }
}
