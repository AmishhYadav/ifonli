"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { bootAccountWishlist, hasAccountHint } from "./account-sync";

/**
 * Renders nothing. When this browser carries the "customer session" hint cookie it starts the account
 * wishlist sync once (merge on first sign-in from this device, then follow the account). It re-checks on
 * navigation, so signing in or out without a full page load is picked up on the next route change.
 */
export function WishlistAccountSync() {
  const pathname = usePathname();
  const running = useRef(false);

  useEffect(() => {
    if (!hasAccountHint()) {
      running.current = false;
      return;
    }
    if (running.current) return;
    running.current = true;
    void bootAccountWishlist()
      .then((signedIn) => {
        if (!signedIn) running.current = false;
      })
      .catch(() => {
        // Offline or a server hiccup: try again on the next navigation; the device list is untouched.
        running.current = false;
      });
  }, [pathname]);

  return null;
}
