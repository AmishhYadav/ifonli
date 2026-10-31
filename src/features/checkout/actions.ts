"use server";

import { unstable_rethrow } from "next/navigation";

import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import { dispatchOutboxSoon } from "@/server/notify/dispatch";
import { onOrderPlacedInTransaction } from "@/server/notify/order-hooks";
import { findCartByToken, findUserCart } from "@/server/services/cart";
import {
  getCheckoutQuote as buildCheckoutQuote,
  lookupPincodeForCheckout,
  type CheckoutQuote,
  type PincodeLookup,
} from "@/server/services/checkout";
import { loadCommerceSettings } from "@/server/services/commerce/settings";
import { initiateRazorpayPayment, retryOrderPayment } from "@/server/payments/initiate";
import type { PaymentInitiator, RazorpayCheckoutPayload } from "@/server/services/commerce/payment-hook";
import { createFromCart } from "@/server/services/orders";
import { limitByIp } from "@/server/security/action-limit";
import { consumeRateLimit } from "@/server/services/rate-limit";

import {
  getRequestIp,
  getSessionUser,
  keyDigest,
  readCartToken,
} from "../cart/request";
import type { ActionResult } from "../cart/types";
import type { PlaceOrderResult } from "./types";
import { checkoutQuoteSchema, pincodeLookupSchema } from "./schema";

/** Creates (or re-opens) the Razorpay order for prepaid checkouts; idempotent per order. */
const initiatePayment: PaymentInitiator = initiateRazorpayPayment;

const SERVER_ERROR = {
  code: "server_error" as const,
  message: "Something went wrong on our side. Please try again.",
};

/** Live checkout quote: pincode, serviceability, COD eligibility, delivery estimate, totals. */
export async function getCheckoutQuote(input: {
  pincode?: string;
  paymentMethod?: "razorpay" | "cod";
  email?: string;
}): Promise<ActionResult<CheckoutQuote>> {
  try {
    const limit = await limitByIp("quote", { limit: 240, windowSeconds: 600 });
    if (limit && !limit.allowed) {
      return {
        ok: false,
        error: {
          code: "rate_limited",
          message: "Too many requests. Please wait a moment and try again.",
          retryAfterSeconds: limit.retryAfterSeconds,
        },
      };
    }
    const parsed = checkoutQuoteSchema.parse(input ?? {});
    const [token, user] = await Promise.all([readCartToken(), getSessionUser()]);
    const db = getDb();
    const row =
      (await findCartByToken(db, token)) ?? (user ? await findUserCart(db, user.id) : null);
    if (!row) {
      return {
        ok: false,
        error: { code: "cart_not_found", message: "Your cart is empty. Add something first." },
      };
    }
    const quote = await buildCheckoutQuote(db, row.id, {
      pincode: parsed.pincode ?? input?.pincode ?? null,
      paymentMethod: parsed.paymentMethod ?? null,
      email: parsed.email ?? user?.email ?? null,
    });
    return { ok: true, data: quote };
  } catch (e) {
    unstable_rethrow(e);
    console.error("getCheckoutQuote failed", e);
    return { ok: false, error: SERVER_ERROR };
  }
}

/** Pincode -> city / state autofill, with serviceability and COD flags (rate limited by IP). */
export async function lookupPincode(input: {
  pincode: string;
}): Promise<ActionResult<PincodeLookup>> {
  const parsed = pincodeLookupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Enter a valid pincode." },
    };
  }
  try {
    const db = getDb();
    const limit = await consumeRateLimit(db, `pincode:ip:${await getRequestIp()}`, {
      limit: 120,
      windowSeconds: 600,
    });
    if (!limit.allowed) {
      return {
        ok: false,
        error: {
          code: "rate_limited",
          message: "Too many lookups. Please wait a moment and try again.",
          retryAfterSeconds: limit.retryAfterSeconds,
        },
      };
    }
    const settings = await loadCommerceSettings(db);
    return { ok: true, data: await lookupPincodeForCheckout(db, parsed.data.pincode, settings) };
  } catch (e) {
    unstable_rethrow(e);
    console.error("lookupPincode failed", e);
    return { ok: false, error: SERVER_ERROR };
  }
}

/**
 * Places the order for the current cart (plan 7.5). `input` is the checkout form
 * (`placeOrderSchema`: contact, address, payment method, policy acknowledgement, idempotency key,
 * vibe); the service validates it again and prices everything on the server. Rate limited by IP and
 * cart.
 */
export async function placeOrder(input: unknown): Promise<PlaceOrderResult> {
  try {
    const [token, user, ip] = await Promise.all([readCartToken(), getSessionUser(), getRequestIp()]);
    const db = getDb();
    const decisions = await Promise.all([
      consumeRateLimit(db, `checkout:ip:${ip}`, { limit: 20, windowSeconds: 600 }),
      consumeRateLimit(db, `checkout:cart:${keyDigest(token ?? ip)}`, { limit: 10, windowSeconds: 600 }),
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
      };
    }

    const cartToken =
      token ?? (user ? ((await findUserCart(db, user.id))?.token ?? null) : null);
    if (!cartToken) {
      return {
        ok: false,
        error: { code: "cart_not_found", message: "Your cart is empty. Add something first." },
      };
    }

    const result = await createFromCart(db, {
      cartToken,
      form: input,
      userId: user?.id ?? null,
      initiatePayment,
      hooks: { onPlacedInTransaction: onOrderPlacedInTransaction },
    });
    if (!result.ok) return { ok: false, error: result.error };
    // COD confirmation e-mails were queued with the order; send them right after the response.
    if (!result.replayed && result.order.paymentMethod === "cod") dispatchOutboxSoon();

    // Reservations (prepaid) and sales (COD) change live availability on cached cards.
    if (!result.replayed && result.productIds.length > 0) {
      revalidateStock({ productIds: result.productIds });
    }
    const o = result.order;
    return {
      ok: true,
      data: {
        orderId: o.orderId,
        ref: o.ref,
        accessToken: o.accessToken,
        paymentMethod: o.paymentMethod,
        status: o.status,
        totalPaise: o.totalPaise,
        currency: o.currency,
        replayed: result.replayed,
        requiresPayment: o.requiresPayment,
        payment: result.payment,
        paymentPending: o.requiresPayment && result.payment === null,
        expiresAt: o.expiresAt ? o.expiresAt.toISOString() : null,
      },
    };
  } catch (e) {
    unstable_rethrow(e);
    console.error("placeOrder failed", e);
    return { ok: false, error: SERVER_ERROR };
  }
}

export type RetryPaymentActionResult =
  | { ok: true; data: { payment: RazorpayCheckoutPayload; expiresAt: string } }
  | {
      ok: false;
      error: {
        code: "not_found" | "not_retryable" | "expired" | "already_paid" | "payment_init_failed" | "rate_limited" | "server_error";
        message: string;
        retryAfterSeconds?: number;
      };
    };

/**
 * "Payment not completed - Retry" (plan 7.6): re-opens Checkout.js on the SAME Razorpay order while
 * the reservation is still valid. `ref` and `token` are the order reference and the guest `?t=` token
 * from the order link. Rate limited by IP and order.
 */
export async function retryPayment(ref: string, token: string): Promise<RetryPaymentActionResult> {
  try {
    if (typeof ref !== "string" || typeof token !== "string" || ref.length > 32 || token.length > 128) {
      return { ok: false, error: { code: "not_found", message: "We couldn't find that order." } };
    }
    const db = getDb();
    const decisions = await Promise.all([
      consumeRateLimit(db, `payretry:ip:${await getRequestIp()}`, { limit: 20, windowSeconds: 600 }),
      consumeRateLimit(db, `payretry:ref:${keyDigest(ref.trim().toUpperCase())}`, { limit: 10, windowSeconds: 600 }),
    ]);
    const blocked = decisions.find((d) => !d.allowed);
    if (blocked) {
      return {
        ok: false,
        error: {
          code: "rate_limited",
          message: "Too many attempts. Please wait a moment and try again.",
          retryAfterSeconds: blocked.retryAfterSeconds,
        },
      };
    }
    const result = await retryOrderPayment(db, { ref, token });
    if (!result.ok) return { ok: false, error: { code: result.code, message: result.message } };
    return { ok: true, data: { payment: result.payload, expiresAt: result.expiresAt.toISOString() } };
  } catch (e) {
    unstable_rethrow(e);
    console.error("retryPayment failed", e);
    return { ok: false, error: SERVER_ERROR };
  }
}
