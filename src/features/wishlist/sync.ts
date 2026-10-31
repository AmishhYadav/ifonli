import type { WishlistEntry } from "./list";

/**
 * The seam for account wishlists (D-20). Guests keep the wishlist on the device only (`store.ts`).
 * For a signed-in customer `WishlistAccountSync` registers the Server Action implementation from
 * `account-sync.ts`: the device store then calls `push` after every local change, and the one-time
 * merge after sign-in is `pull` + `mergeIntoWishlist`. This file stays free of server imports so the
 * store (and its unit tests) never load them. Nothing else in the UI needs to know.
 */
export interface WishlistSync {
  /** The signed-in customer's saved products (empty for guests). */
  pull(): Promise<WishlistEntry[]>;
  /** Replace the account list with the device's merged list. */
  push(entries: readonly WishlistEntry[]): Promise<void>;
}

let current: WishlistSync | null = null;

/** Registers the account sync; pass `null` to go back to device-only. */
export function registerWishlistSync(sync: WishlistSync | null): void {
  current = sync;
}

export function getWishlistSync(): WishlistSync | null {
  return current;
}
