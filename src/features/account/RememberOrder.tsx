"use client";

import { useEffect } from "react";

import { rememberOrder } from "./profile-store";

/**
 * On an order page opened with its own link: keep that link in this browser, so My Profile can list the order
 * and open its tracking. The link is the order's access token, so it is only ever stored on the visitor's device.
 */
export function RememberOrder({ reference, token }: { reference: string; token: string }) {
  useEffect(() => {
    if (!token) return;
    rememberOrder({
      ref: reference,
      href: `/orders/${encodeURIComponent(reference)}?t=${encodeURIComponent(token)}`,
    });
  }, [reference, token]);
  return null;
}
