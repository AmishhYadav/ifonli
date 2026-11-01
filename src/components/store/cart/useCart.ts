"use client";

import { useOptimistic, useSyncExternalStore, useTransition } from "react";

import type { CartView } from "@/features/cart/types";
import { removedQuantity } from "@/lib/analytics/cart-events";
import { track } from "@/lib/analytics/client";

import { applyOptimistic, type CartOptimisticAction } from "./cart-math";
import {
  getCartState,
  getServerCartState,
  removeItem,
  setItemQuantity,
  subscribeCart,
  type CartStoreState,
} from "./cart-store";

export function useCartStore(): CartStoreState {
  return useSyncExternalStore(subscribeCart, getCartState, getServerCartState);
}

/**
 * The cart a surface should render plus optimistic quantity / remove handlers. `useOptimistic` shows the
 * change immediately; when the Server Action returns, the store holds the server's truth (stock caps,
 * recalculated discount and shipping) and the optimistic layer is dropped.
 */
export function useOptimisticCart(cart: CartView) {
  const [optimistic, dispatch] = useOptimistic<CartView, CartOptimisticAction>(cart, applyOptimistic);
  const [pending, startTransition] = useTransition();

  /** `remove_from_cart` for units taken out, once the server confirmed (the optimistic view is not proof). */
  const trackRemoved = (line: CartView["lines"][number] | undefined, to: number, ok: boolean) => {
    if (!line || !ok) return;
    const units = removedQuantity(line.qty, to);
    if (units > 0) track("remove_from_cart", { productId: line.productId, value: units });
  };

  const setQuantity = (variantId: string, qty: number) =>
    startTransition(async () => {
      const line = optimistic.lines.find((l) => l.variantId === variantId);
      dispatch({ type: "qty", variantId, qty });
      const result = await setItemQuantity(variantId, qty);
      // A decrease is a removal of the difference; increases are not tracked here (they are not an add from a product page).
      trackRemoved(line, qty, result.ok);
    });

  const remove = (variantId: string, after?: () => void) =>
    startTransition(async () => {
      const line = optimistic.lines.find((l) => l.variantId === variantId);
      dispatch({ type: "remove", variantId });
      const result = await removeItem(variantId);
      trackRemoved(line, 0, result.ok);
      after?.();
    });

  return { cart: optimistic, pending, setQuantity, remove };
}
