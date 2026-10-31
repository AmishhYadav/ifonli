import type { Metadata } from "next";
import { Suspense } from "react";

import { CheckoutForm, type CheckoutPrefill } from "@/components/checkout/CheckoutForm";
import { CheckoutSkeleton } from "@/components/checkout/CheckoutSkeleton";
import { EmptyCheckout } from "@/components/checkout/EmptyCheckout";
import { getCurrentCartView } from "@/features/cart/queries";
import { getSessionUser } from "@/features/cart/request";
import { getDb } from "@/server/db";
import { getCustomerProfile, getDefaultAddress } from "@/server/services/accounts";
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

/** The signed-in customer's saved mobile number and default address, for the contact and delivery fields. */
async function loadPrefill(userId: string): Promise<CheckoutPrefill | null> {
  try {
    const db = getDb();
    const [profile, address] = await Promise.all([
      getCustomerProfile(db, userId),
      getDefaultAddress(db, userId),
    ]);
    if (!profile && !address) return null;
    return {
      phone: address?.phone ?? profile?.phone ?? "",
      address: address
        ? {
            name: address.name,
            line1: address.line1,
            line2: address.line2 ?? "",
            landmark: address.landmark ?? "",
            city: address.city,
            state: address.state,
            pincode: address.pincode,
          }
        : profile?.name
          ? {
              name: profile.name,
              line1: "",
              line2: "",
              landmark: "",
              city: "",
              state: "",
              pincode: "",
            }
          : null,
    };
  } catch (error) {
    // Prefill is a convenience: the form works without it.
    console.error("checkout prefill failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

async function CheckoutContent() {
  const [cart, user, summary] = await Promise.all([
    getCurrentCartView(),
    getSessionUser(),
    returnSummary(),
  ]);
  if (cart.lines.length === 0) return <EmptyCheckout />;
  const prefill = user ? await loadPrefill(user.id) : null;
  return (
    <CheckoutForm
      initialCart={cart}
      initialEmail={user?.email ?? null}
      initialPrefill={prefill}
      returnSummary={summary}
    />
  );
}

export default function CheckoutPage() {
  return (
    <>
      <h1 className="mb-6 font-display text-4xl leading-tight">Checkout</h1>
      <Suspense fallback={<CheckoutSkeleton />}>
        <CheckoutContent />
      </Suspense>
    </>
  );
}
