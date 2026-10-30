/**
 * Serialisable shapes returned by the checkout Server Actions. Type-only imports from server code,
 * so client components can use them.
 */
import type { CheckoutQuote, PincodeLookup } from "@/server/services/checkout";
import type { RazorpayCheckoutPayload } from "@/server/services/commerce/payment-hook";
import type { OrderError, ShortageItem } from "@/server/services/orders";

export type { CheckoutQuote, OrderError, PincodeLookup, RazorpayCheckoutPayload, ShortageItem };

/** What the browser gets back from a placed order. Dates are ISO strings. */
export interface PlaceOrderData {
  orderId: string;
  ref: string;
  /** Raw guest access token for the `?t=` order link. Shown once; keep it in the redirect URL. */
  accessToken: string;
  paymentMethod: "razorpay" | "cod";
  status: string;
  totalPaise: number;
  currency: "INR";
  /** True when this was a repeat submit that returned the existing order. */
  replayed: boolean;
  /** Prepaid and not yet paid: open Razorpay Checkout with `payment`. */
  requiresPayment: boolean;
  /** Razorpay Checkout.js payload; null for COD and until the payments module is wired in. */
  payment: RazorpayCheckoutPayload | null;
  /** Prepaid order created but no provider order yet (payments module not wired in). */
  paymentPending: boolean;
  expiresAt: string | null;
}

export type PlaceOrderResult =
  | { ok: true; data: PlaceOrderData }
  | {
      ok: false;
      error: OrderError | { code: "rate_limited" | "server_error"; message: string; retryAfterSeconds?: number };
    };


