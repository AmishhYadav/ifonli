import type { RazorpayCheckoutPayload } from "@/features/checkout/types";

/**
 * Razorpay Checkout.js loader. The script is injected on demand (when the customer pays, never on page
 * load), and this is the ONE place that creates the tag: when a Content-Security-Policy arrives, add the
 * nonce here and `https://checkout.razorpay.com` to script-src / frame-src / connect-src.
 */
export const CHECKOUT_JS_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export interface RazorpaySuccessResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayFailureResponse {
  error?: { code?: string; description?: string; reason?: string };
}

interface RazorpayOptions {
  key: string;
  /** Paise. */
  amount: number;
  currency: string;
  order_id: string;
  name?: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (response: RazorpaySuccessResponse) => void;
  modal?: { ondismiss?: () => void; confirm_close?: boolean };
}

interface RazorpayInstance {
  open(): void;
  close(): void;
  on(event: "payment.failed", callback: (response: RazorpayFailureResponse) => void): void;
}

type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let loading: Promise<RazorpayConstructor> | null = null;

/** Resolves with the `Razorpay` constructor, loading Checkout.js once. Rejects (and may be retried) on failure. */
export function loadCheckoutJs(): Promise<RazorpayConstructor> {
  if (typeof window === "undefined")
    return Promise.reject(new Error("Checkout.js needs a browser"));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_JS_SRC;
    script.async = true;
    script.onload = () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else {
        loading = null;
        reject(new Error("Checkout.js loaded without Razorpay"));
      }
    };
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Checkout.js failed to load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export interface CheckoutHandlers {
  onSuccess: (response: RazorpaySuccessResponse) => void;
  /** The customer closed the popup without paying. */
  onDismiss: () => void;
  /** A payment attempt failed inside the popup (it stays open so they can try another method). */
  onFailed: (message: string | null) => void;
}

/** Opens the Checkout.js popup for a payload from `placeOrder` / `retryPayment`. */
export async function openRazorpayCheckout(
  payload: RazorpayCheckoutPayload,
  handlers: CheckoutHandlers,
): Promise<void> {
  const Razorpay = await loadCheckoutJs();
  const instance = new Razorpay({
    key: payload.keyId,
    amount: payload.amountPaise,
    currency: payload.currency,
    order_id: payload.razorpayOrderId,
    name: payload.name,
    description: payload.description,
    prefill: payload.prefill,
    notes: payload.notes,
    theme: payload.themeColor ? { color: payload.themeColor } : undefined,
    handler: handlers.onSuccess,
    modal: { ondismiss: handlers.onDismiss, confirm_close: true },
  });
  instance.on("payment.failed", (response) =>
    handlers.onFailed(response.error?.description ?? null),
  );
  instance.open();
}
