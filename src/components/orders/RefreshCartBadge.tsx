"use client";

import { useEffect } from "react";

import { refreshCart } from "@/components/store/cart/cart-store";

/**
 * Renders nothing. Placing an order empties the cart on the server, but the client cart store still holds
 * the old view, so the header badge would keep showing the old count after "Continue shopping". Loading the
 * cart from the server when the order page opens brings the store (and the badge) back in line.
 */
export function RefreshCartBadge() {
  useEffect(() => {
    void refreshCart();
  }, []);
  return null;
}
