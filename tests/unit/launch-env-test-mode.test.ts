import { describe, expect, it } from "vitest";

import { checkEnvironment } from "@/server/services/admin/launch";

const LIVE_ENV = {
  NODE_ENV: "production",
  RAZORPAY_KEY_ID: "rzp_live_abc123",
  RAZORPAY_KEY_SECRET: "secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec",
  RESEND_API_KEY: "re_123",
  EMAIL_FROM: "IfOnli <orders@ifonli.in>",
  BETTER_AUTH_SECRET: "x".repeat(40),
  CSP_MODE: "enforce",
  CRON_SECRET: "c".repeat(40),
  NEXT_PUBLIC_SITE_URL: "https://ifonli.in",
  SUPABASE_URL: "https://abc.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SENTRY_DSN: "https://sentry.example/1",
};

const razorpay = (over: Record<string, string | undefined>) =>
  checkEnvironment({ ...LIVE_ENV, ...over })
    .filter((i) => i.id.startsWith("env:razorpay") || i.id === "env:payments-test-mode")
    .map((i) => [i.id, i.severity]);

describe("checkEnvironment: Razorpay and PAYMENTS_TEST_MODE", () => {
  it("test keys without the flag are a blocker", () => {
    expect(razorpay({ RAZORPAY_KEY_ID: "rzp_test_x" })).toEqual([["env:razorpay", "blocker"]]);
    expect(razorpay({ RAZORPAY_KEY_ID: "rzp_test_x", PAYMENTS_TEST_MODE: "0" })).toEqual([
      ["env:razorpay", "blocker"],
    ]);
    expect(razorpay({ RAZORPAY_KEY_ID: "rzp_test_x", PAYMENTS_TEST_MODE: "true" })).toEqual([
      ["env:razorpay", "blocker"],
    ]);
  });

  it("test keys with PAYMENTS_TEST_MODE=1 are only a warning", () => {
    const items = checkEnvironment({ ...LIVE_ENV, RAZORPAY_KEY_ID: "rzp_test_x", PAYMENTS_TEST_MODE: "1" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "env:razorpay",
      severity: "warning",
      title: "Razorpay is in test mode",
    });
    expect(items[0]!.detail).toMatch(/rzp_live_/);
    expect(items[0]!.detail).toMatch(/remove PAYMENTS_TEST_MODE/);
  });

  it("missing keys stay a blocker even with the flag", () => {
    const over = { PAYMENTS_TEST_MODE: "1" };
    expect(razorpay({ ...over, RAZORPAY_KEY_ID: undefined })).toEqual([["env:razorpay", "blocker"]]);
    expect(razorpay({ ...over, RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "" })).toEqual([
      ["env:razorpay", "blocker"],
    ]);
  });

  it("a missing webhook secret stays a blocker in test mode", () => {
    expect(
      razorpay({ RAZORPAY_KEY_ID: "rzp_test_x", PAYMENTS_TEST_MODE: "1", RAZORPAY_WEBHOOK_SECRET: "" }),
    ).toEqual([
      ["env:razorpay", "warning"],
      ["env:razorpay-webhook", "blocker"],
    ]);
  });

  it("the flag with live keys is a warning that it has no effect", () => {
    expect(razorpay({ PAYMENTS_TEST_MODE: "1" })).toEqual([["env:payments-test-mode", "warning"]]);
    expect(razorpay({ PAYMENTS_TEST_MODE: "0" })).toEqual([]);
  });

  it("no item echoes a key value", () => {
    const text = JSON.stringify(
      checkEnvironment({ ...LIVE_ENV, RAZORPAY_KEY_ID: "rzp_test_SECRETKEYID", PAYMENTS_TEST_MODE: "1" }),
    );
    expect(text).not.toContain("SECRETKEYID");
  });
});
