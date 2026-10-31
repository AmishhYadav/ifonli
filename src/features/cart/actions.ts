"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/server/db";
import * as cart from "@/server/services/cart";
import { limitByIp } from "@/server/security/action-limit";
import { consumeRateLimit } from "@/server/services/rate-limit";

import { getRequestIp, getSessionUser, keyDigest, readCartToken, writeCartToken } from "./request";
import type { ActionError, ActionResult, CartActionData } from "./types";

const variantIdSchema = z.uuid("That item couldn't be found.");
const qtySchema = z.number().int("Choose a whole number.").min(0).max(999);
const lineSchema = z.object({ variantId: variantIdSchema, qty: qtySchema });
const codeSchema = z.object({
  code: z
    .string({ error: "Enter a coupon code." })
    .trim()
    .min(1, "Enter a coupon code.")
    .max(64, "That code is too long."),
});

const SERVER_ERROR: ActionError = {
  code: "server_error",
  message: "Something went wrong on our side. Please try again.",
};

function invalid(error: z.ZodError): ActionResult<never> {
  return {
    ok: false,
    error: { code: "invalid_input", message: error.issues[0]?.message ?? "Please check your input." },
  };
}

function fromMutation(m: Extract<cart.CartMutation, { ok: false }>): ActionResult<never> {
  return {
    ok: false,
    error: { code: m.code, message: m.message, ...(m.couponCode ? { couponCode: m.couponCode } : {}) },
  };
}

/**
 * Shared shape of a mutation: resolve (or create) the visitor's cart and keep the cookie in step
 * with it, run the mutation, then return the freshly re-validated cart.
 */
async function mutate(
  run: (cartId: string, user: { id: string; email: string } | null) => Promise<cart.CartMutation>,
): Promise<ActionResult<CartActionData>> {
  try {
    // A bot that never sends the cookie would otherwise create a cart row per call.
    const limit = await limitByIp("cart", { limit: 240, windowSeconds: 600 });
    if (limit && !limit.allowed) {
      return {
        ok: false,
        error: {
          code: "rate_limited",
          message: "Too many cart changes in a short time. Please wait a moment and try again.",
          retryAfterSeconds: limit.retryAfterSeconds,
        },
      };
    }
    const [token, user] = await Promise.all([readCartToken(), getSessionUser()]);
    const db = getDb();
    const { cart: row } = await cart.getOrCreateCart(db, token, user?.id);
    if (row.token !== token) await writeCartToken(row.token);

    const result = await run(row.id, user);
    if (!result.ok) return fromMutation(result);

    const view = await cart.getCartView(db, row.id, { email: user?.email });
    return { ok: true, data: { cart: view, notices: [...result.notices, ...view.notices] } };
  } catch (e) {
    unstable_rethrow(e);
    console.error("cart action failed", e);
    return { ok: false, error: SERVER_ERROR };
  }
}

/** The visitor's cart, re-validated against live stock. Does not create a cart or set a cookie. */
export async function getCart(): Promise<ActionResult<CartActionData>> {
  try {
    const [token, user] = await Promise.all([readCartToken(), getSessionUser()]);
    const db = getDb();
    const row =
      (await cart.findCartByToken(db, token)) ?? (user ? await cart.findUserCart(db, user.id) : null);
    const view = row
      ? await cart.getCartView(db, row.id, { email: user?.email })
      : cart.emptyCartView();
    return { ok: true, data: { cart: view, notices: view.notices } };
  } catch (e) {
    unstable_rethrow(e);
    console.error("getCart failed", e);
    return { ok: false, error: SERVER_ERROR };
  }
}

/** Adds to the line, capped at `min(available, max_qty_per_line)`. */
export async function addToCart(input: { variantId: string; qty: number }) {
  const parsed = lineSchema.refine((v) => v.qty >= 1, { message: "Choose a quantity of 1 or more." }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { variantId, qty } = parsed.data;
  return mutate((cartId) => cart.addItem(getDb(), cartId, { variantId, qty }));
}

/** Sets the line to exactly `qty` (0 removes it). */
export async function setCartQuantity(input: { variantId: string; qty: number }) {
  const parsed = lineSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { variantId, qty } = parsed.data;
  return mutate((cartId) => cart.setQuantity(getDb(), cartId, { variantId, qty }));
}

export async function removeCartItem(input: { variantId: string }) {
  const parsed = z.object({ variantId: variantIdSchema }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { variantId } = parsed.data;
  return mutate((cartId) => cart.removeItem(getDb(), cartId, { variantId }));
}

/** Validates and stores a coupon code (rate limited by IP and cart). */
export async function applyCoupon(input: { code: string }) {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { code } = parsed.data;

  const [ip, token] = await Promise.all([getRequestIp(), readCartToken()]);
  const db = getDb();
  try {
    const decisions = await Promise.all([
      consumeRateLimit(db, `coupon:ip:${ip}`, { limit: 30, windowSeconds: 600 }),
      consumeRateLimit(db, `coupon:cart:${keyDigest(token ?? ip)}`, { limit: 10, windowSeconds: 600 }),
    ]);
    const blocked = decisions.find((d) => !d.allowed);
    if (blocked) {
      const minutes = Math.ceil(blocked.retryAfterSeconds / 60);
      return {
        ok: false,
        error: {
          code: "rate_limited",
          message: `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
          retryAfterSeconds: blocked.retryAfterSeconds,
        },
      } satisfies ActionResult<never>;
    }
  } catch (e) {
    unstable_rethrow(e);
    console.error("coupon rate limit failed", e);
    return { ok: false, error: SERVER_ERROR } satisfies ActionResult<never>;
  }
  return mutate((cartId, user) => cart.applyCoupon(getDb(), cartId, code, { email: user?.email }));
}

export async function removeCoupon() {
  return mutate((cartId) => cart.removeCoupon(getDb(), cartId));
}

/**
 * Call right after a customer logs in: merges the guest cart (cookie) into their account cart and
 * points the cookie at the surviving cart. Does nothing for guests.
 */
export async function mergeGuestCart(): Promise<ActionResult<CartActionData>> {
  try {
    const [token, user] = await Promise.all([readCartToken(), getSessionUser()]);
    if (!user) {
      return { ok: false, error: { code: "not_signed_in", message: "Please sign in first." } };
    }
    const db = getDb();
    const merged = await cart.mergeCarts(db, token, user.id);
    if (merged.token && merged.token !== token) await writeCartToken(merged.token);
    const row = await cart.findCartByToken(db, merged.token);
    const view = row ? await cart.getCartView(db, row.id, { email: user.email }) : cart.emptyCartView();
    return { ok: true, data: { cart: view, notices: [...merged.notices, ...view.notices] } };
  } catch (e) {
    unstable_rethrow(e);
    console.error("mergeGuestCart failed", e);
    return { ok: false, error: SERVER_ERROR };
  }
}
