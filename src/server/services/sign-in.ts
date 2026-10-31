import "server-only";

import { and, isNull, sql } from "drizzle-orm";

import { orders } from "@/server/db/schema";

import { mergeCarts, type MergeResult } from "./cart";
import type { DbClient } from "./queries/shared";

/**
 * Guest orders placed with this e-mail address, claimed by the account that just proved it owns the
 * address (D-AUTH-2). Only rows with no owner (`user_id IS NULL`) and a case-insensitive e-mail match
 * move, so another customer's orders are never touched and running it again changes nothing.
 * `email` must be the verified address from the session, never a form value.
 */
export async function attachGuestOrders(
  db: DbClient,
  userId: string,
  email: string,
): Promise<number> {
  const rows = await db
    .update(orders)
    .set({ userId })
    .where(and(isNull(orders.userId), sql`lower(${orders.email}) = lower(${email.trim()})`))
    .returning({ id: orders.id });
  return rows.length;
}

export interface SignInOutcome {
  /** Cart token the browser should use from now on; null when neither a guest nor a user cart exists. */
  cartToken: string | null;
  cart: MergeResult;
  attachedOrders: number;
}

/**
 * Everything that happens once, server side, when a customer finishes signing in. Idempotent: the
 * guest cart can only be merged once (it is deleted or claimed), and orders are only attached while
 * they have no owner.
 *  1. merge the guest cart (cookie) into the customer's cart;
 *  2. attach past guest orders with the verified e-mail.
 * The wishlist is merged on the device (`WishlistSync`), after the page reloads with the session.
 */
export async function completeCustomerSignIn(
  db: DbClient,
  input: { userId: string; email: string; guestCartToken: string | null },
  now: Date = new Date(),
): Promise<SignInOutcome> {
  const cart = await mergeCarts(db, input.guestCartToken, input.userId, now);
  const attachedOrders = await attachGuestOrders(db, input.userId, input.email);
  return { cartToken: cart.token, cart, attachedOrders };
}
