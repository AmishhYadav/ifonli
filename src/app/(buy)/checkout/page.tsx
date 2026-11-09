import type { Metadata } from "next";
import { Suspense } from "react";

import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { ClosedCheckout } from "@/components/checkout/ClosedCheckout";
import { CheckoutSkeleton } from "@/components/checkout/CheckoutSkeleton";
import { EmptyCheckout } from "@/components/checkout/EmptyCheckout";
import { getCurrentCartView } from "@/features/cart/queries";
import { getSessionUser } from "@/features/cart/request";
import { getServerEnv } from "@/lib/env";
import { getDb } from "@/server/db";
import { isRazorpayTestMode } from "@/server/payments/test-mode";
import { loadCheckoutPrefill } from "@/server/services/account";
import { getOrderGate, STORE_CLOSED_MESSAGE } from "@/server/services/commerce/launch-gate";
import { readSettings } from "@/server/services/queries/shared";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

/** Plain-language returns summary for the acknowledgement; follows the owner's return-policy settings. */
async function returnSummary(): Promise<string> {
  const s = await readSettings(getDb(), [
    "return_policy_type",
    "returns_window_days",
    "damaged_claim_window_hours",
  ]);
  const hours = s.damaged_claim_window_hours;
  const claim =
    hours.isPlaceholder || hours.value <= 0
      ? "If an item arrives damaged, defective or not what you ordered, tell us after it arrives and we'll make it right."
      : `If an item arrives damaged, defective or not what you ordered, report it within ${hours.value} hours of delivery and we'll make it right.`;
  const days = s.returns_window_days;
  if (s.return_policy_type.value === "returns_window" && !days.isPlaceholder && days.value > 0) {
    return `You can return items within ${days.value} days of delivery, as set out in the returns policy. ${claim}`;
  }
  return `We don't accept returns or exchanges for change of mind. ${claim}`;
}

async function CheckoutContent() {
  const [cart, user, summary] = await Promise.all([
    getCurrentCartView(),
    getSessionUser(),
    returnSummary(),
  ]);
  if (cart.lines.length === 0) return <EmptyCheckout />;
  // Production launch gate: no form that cannot be submitted.
  if (!(await getOrderGate(getDb())).open) return <ClosedCheckout message={STORE_CLOSED_MESSAGE} />;
  // Signed-in customers start from their default saved address and profile phone.
  const prefill = user ? await loadCheckoutPrefill(getDb(), user.id).catch(() => null) : null;
  return (
    <CheckoutForm
      initialCart={cart}
      initialEmail={user?.email ?? null}
      returnSummary={summary}
      savedAddresses={prefill?.addresses ?? []}
      initialPhone={prefill?.phone ?? null}
      testMode={isRazorpayTestMode(getServerEnv())}
    />
  );
}

export default function CheckoutPage() {
  return (
    <>
      <h1 className="buy-display buy-display-fx mb-6 text-4xl leading-tight">Checkout</h1>
      <Suspense fallback={<CheckoutSkeleton />}>
        <CheckoutContent />
      </Suspense>
    </>
  );
}
