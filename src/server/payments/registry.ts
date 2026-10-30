import "server-only";

import { getServerEnv } from "@/lib/env";

import { MockPaymentProvider } from "./mock";
import { createRazorpayProvider } from "./razorpay";
import { PaymentConfigError, type PaymentProvider } from "./provider";

/**
 * Which provider the app talks to.
 *  - Razorpay keys set: the real provider (any environment; use `rzp_test_` keys outside production).
 *  - Keys empty, development or test: the in-memory mock, so the checkout can be exercised end to end
 *    without a Razorpay account (see `app/api/dev/mock-checkout`).
 *  - Keys empty in production: a hard `PaymentConfigError`. The payment path fails loudly instead of
 *    ever pretending an order is paid.
 */
interface Slot {
  provider?: PaymentProvider;
  override?: PaymentProvider;
}
const slot = ((globalThis as unknown as { __ifonliPayments?: Slot }).__ifonliPayments ??= {});

export function getPaymentProvider(): PaymentProvider {
  if (slot.override) return slot.override;
  if (slot.provider) return slot.provider;

  const env = getServerEnv();
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
    slot.provider = createRazorpayProvider({
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    });
  } else if (env.NODE_ENV === "production") {
    throw new PaymentConfigError(
      "Razorpay is not configured: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (and RAZORPAY_WEBHOOK_SECRET).",
    );
  } else {
    slot.provider = new MockPaymentProvider();
  }
  return slot.provider;
}

/** True when the dev mock is the active provider (never in production). */
export function isMockProvider(provider: PaymentProvider = getPaymentProvider()): boolean {
  return provider.name === "mock";
}

/** Tests: force a provider (or `null` to go back to the environment default). Refused in production. */
export function setPaymentProvider(provider: PaymentProvider | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new PaymentConfigError("The payment provider cannot be overridden in production.");
  }
  slot.override = provider ?? undefined;
}
