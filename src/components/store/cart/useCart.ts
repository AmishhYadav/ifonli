"use client";

import { useOptimistic, useSyncExternalStore, useTransition } from "react";

import type { CartView } from "@/features/cart/types";

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

  const setQuantity = (variantId: string, qty: number) =>
    startTransition(async () => {
      dispatch({ type: "qty", variantId, qty });
      await setItemQuantity(variantId, qty);
    });

  const remove = (variantId: string, after?: () => void) =>
    startTransition(async () => {
      dispatch({ type: "remove", variantId });
      await removeItem(variantId);
      after?.();
    });

  return { cart: optimistic, pending, setQuantity, remove };
}
