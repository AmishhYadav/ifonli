import "server-only";

import { getDb } from "@/server/db";
import {
  emptyCartView,
  getCartItemCount,
  getCartView,
  resolveViewerCart,
  type CartView,
} from "@/server/services/cart";

import { getSessionUser, readCartToken } from "./request";

/**
 * Cart for the current request, for pages and layouts (reads the cookie, so it is dynamic: render it
 * inside a `<Suspense>` boundary under `cacheComponents`). Re-validates the cart against live stock.
 * Never creates a cart or sets a cookie; a visitor without one gets an empty view.
 */
export async function getCurrentCartView(): Promise<CartView> {
  const [token, user] = await Promise.all([readCartToken(), getSessionUser()]);
  const db = getDb();
  const row = await resolveViewerCart(db, token, user?.id);
  return row ? getCartView(db, row.id, { email: user?.email }) : emptyCartView();
}

/** Item count for the header badge: one cheap query, no pricing. Also dynamic. */
export async function getCurrentCartCount(): Promise<number> {
  const [token, user] = await Promise.all([readCartToken(), getSessionUser()]);
  const db = getDb();
  const row = await resolveViewerCart(db, token, user?.id);
  return row ? getCartItemCount(db, row.id) : 0;
}
