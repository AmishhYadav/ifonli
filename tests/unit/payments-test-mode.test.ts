import { describe, expect, it } from "vitest";

import { isRazorpayTestMode } from "@/server/payments/test-mode";

describe("isRazorpayTestMode", () => {
  it("is true only for Razorpay test keys", () => {
    expect(isRazorpayTestMode({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "s" })).toBe(true);
    expect(isRazorpayTestMode({ RAZORPAY_KEY_ID: "rzp_live_abc", RAZORPAY_KEY_SECRET: "s" })).toBe(false);
  });
  it("is false for the dev mock (no keys) and for half a configuration", () => {
    expect(isRazorpayTestMode({})).toBe(false);
    expect(isRazorpayTestMode({ RAZORPAY_KEY_ID: "rzp_test_abc" })).toBe(false);
    expect(isRazorpayTestMode({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: " " })).toBe(false);
  });
});
