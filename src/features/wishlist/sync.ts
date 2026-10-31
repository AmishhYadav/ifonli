import type { WishlistEntry } from "./list";

/**
 * The seam for account wishlists (a later phase). Today the wishlist lives only on the device
 * (`store.ts`). When accounts arrive, implement this interface against a Server Action / table and
 * register it with `registerWishlistSync`; the device store then calls `push` after every local
 * change and `pull` + `mergeWishlists` once after sign-in. Nothing else in the UI needs to change.
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
