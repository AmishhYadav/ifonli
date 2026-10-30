import "server-only";

import type { CapturedPayment } from "@/server/services/payments";

import { PaymentProviderError, type PaymentProvider, type ProviderPayment } from "./provider";

export type ConfirmResult =
  | { ok: true; payment: CapturedPayment }
  | {
      ok: false;
      reason: "not_captured" | "order_mismatch" | "provider_error";
      status?: ProviderPayment["status"];
      retryable?: boolean;
    };

function toCaptured(p: ProviderPayment): CapturedPayment {
  return { providerOrderId: p.orderId!, providerPaymentId: p.id, amountPaise: p.amountPaise, method: p.method };
}

/**
 * "Never mark paid without a verified capture" (plan 7.6): asks the provider about the payment
 * instead of trusting the browser or the webhook body. The payment must belong to
 * `expectedProviderOrderId` and be `captured`; an `authorized` payment is captured through the API
 * first (re-fetching if another caller captured it meanwhile). The AMOUNT is checked by
 * `finalizePaidOrder` against the order total.
 */
export async function confirmProviderPayment(
  provider: PaymentProvider,
  providerPaymentId: string,
  expectedProviderOrderId: string,
): Promise<ConfirmResult> {
  try {
    let p = await provider.fetchPayment(providerPaymentId);
    if (p.orderId !== expectedProviderOrderId) return { ok: false, reason: "order_mismatch" };
    if (p.currency !== "INR") return { ok: false, reason: "order_mismatch" };
    if (p.status === "authorized") {
      try {
        p = await provider.capture(p.id, p.amountPaise);
      } catch (e) {
        p = await provider.fetchPayment(providerPaymentId); // lost a capture race?
        if (p.status !== "captured") throw e;
      }
    }
    if (p.status !== "captured") return { ok: false, reason: "not_captured", status: p.status };
    return { ok: true, payment: toCaptured(p) };
  } catch (e) {
    if (e instanceof PaymentProviderError) {
      return { ok: false, reason: "provider_error", retryable: e.retryable };
    }
    throw e;
  }
}

/** Same rules for a payment already listed by the provider (reconcile cron). */
export async function confirmListedPayment(
  provider: PaymentProvider,
  p: ProviderPayment,
): Promise<ConfirmResult> {
  if (!p.orderId || p.currency !== "INR") return { ok: false, reason: "order_mismatch" };
  if (p.status === "captured") return { ok: true, payment: toCaptured(p) };
  if (p.status === "authorized") return confirmProviderPayment(provider, p.id, p.orderId);
  return { ok: false, reason: "not_captured", status: p.status };
}
