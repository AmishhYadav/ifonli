"use client";

import { useEffect } from "react";

import { endAccountWishlist } from "@/features/wishlist/account-sync";

/** After deletion: stop syncing and clear this device's wishlist copy. Renders nothing. */
export function DeletedCleanup() {
  useEffect(() => {
    endAccountWishlist();
  }, []);
  return null;
}
