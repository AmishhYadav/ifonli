"use client";

import { useSyncExternalStore } from "react";

import { getServerWishlist, getWishlist, isInWishlist, subscribeWishlist } from "./store";
import type { WishlistEntry } from "./list";

/** All saved entries (newest first). `null` on the server and during hydration, so UI can show a skeleton. */
export function useWishlistEntries(): readonly WishlistEntry[] | null {
  return useSyncExternalStore<readonly WishlistEntry[] | null>(subscribeWishlist, getWishlist, () => null);
}

/** Is this product saved? `false` on the server, so the first paint matches the markup. */
export function useIsWishlisted(productId: string): boolean {
  return useSyncExternalStore(
    subscribeWishlist,
    () => isInWishlist(productId),
    () => false,
  );
}

/** Number of saved products (0 on the server). */
export function useWishlistCount(): number {
  return useSyncExternalStore(
    subscribeWishlist,
    () => getWishlist().length,
    () => getServerWishlist().length,
  );
}
