/**
 * Contract between order creation (`services/orders.ts`) and the payments module.
 *
 * `createFromCart` commits the prepaid order and its stock reservation, then (OUTSIDE the
 * transaction, plan 7.5 step 4) calls the `PaymentInitiator` it was given. The initiator creates
 * the Razorpay Order (`amount` in paise, `currency: "INR"`, `receipt: ref`, `notes.order_id`),
 * stores `payments(provider_order_id)` and returns what Checkout.js needs. If it reports failure
 * the order is expired again (reservation + coupon released) and the customer can retry.
 *
 * Types only: no runtime code, no server-only import, so UI code may import them.
 */

/** What the browser needs to open Razorpay Checkout (plan 7.5 step 5). */
export interface RazorpayCheckoutPayload {
  /** Public key id (never the secret). */
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: "INR";
  prefill: { name: string; email: string; contact: string };
  /** Brand colour for the Checkout.js theme (optional). */
  themeColor?: string;
}

/** Everything the initiator may need about the freshly created prepaid order. */
export interface PaymentInitContext {
  orderId: string;
  /** Human reference, used as the Razorpay `receipt`. */
  ref: string;
  amountPaise: number;
  currency: "INR";
  email: string;
  /** Normalised +91XXXXXXXXXX. */
  phone: string;
  customerName: string;
  /** Reservation / payment deadline. */
  expiresAt: Date;
}

export type PaymentInitResult =
  | { ok: true; payload: RazorpayCheckoutPayload }
  | { ok: false; message: string; retryable?: boolean };

export type PaymentInitiator = (ctx: PaymentInitContext) => Promise<PaymentInitResult>;
