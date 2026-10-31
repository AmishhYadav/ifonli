import { track } from "@/lib/analytics/client";

/**
 * Checkout funnel steps (GA4 `add_shipping_info` / `add_payment_info`). Checkout is one page, so both fire
 * when the form is submitted with valid details, just before the order is placed. They carry no personal
 * data: only which payment method was chosen.
 */

/** The delivery address was entered and passed validation (the pincode is serviceable). */
export function trackShippingInfo(): void {
  track("add_shipping_info");
}

/** A payment method was chosen as the form was submitted: `razorpay` (online) or `cod`. */
export function trackPaymentInfo(method: "razorpay" | "cod"): void {
  track("add_payment_info", { meta: { method } });
}
