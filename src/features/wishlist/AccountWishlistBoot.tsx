"use client";

import { useEffect } from "react";

import { resumeAccountWishlist } from "./account-sync";

/** Renders nothing. Reconnects the device wishlist to the signed-in account on each page load. */
export function AccountWishlistBoot() {
  useEffect(() => {
    void resumeAccountWishlist();
  }, []);
  return null;
}
