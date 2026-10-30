import { afterEach, describe, expect, it, vi } from "vitest";

import { isCronAuthorized } from "@/server/payments/cron-auth";
import { MockPaymentProvider, MOCK_KEY_SECRET } from "@/server/payments/mock";
import { PaymentConfigError } from "@/server/payments/provider";
import { normalizeRazorpayPayment, normalizeRazorpayRefund } from "@/server/payments/razorpay";
import { sanitizeWebhookPayload } from "@/server/payments/sanitize";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete (globalThis as { __ifonliPayments?: unknown }).__ifonliPayments;
});

describe("sanitizeWebhookPayload", () => {
  it("drops personal fields at any depth and keeps ids, amounts and statuses", () => {
    const out = sanitizeWebhookPayload({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_1",
            amount: 100,
            status: "captured",
            email: "a@b.co",
            contact: "+919999999999",
            vpa: "x@upi",
            card: { last4: "1111" },
            notes: { ref: "x" },
            acquirer_data: { rrn: "1" },
            list: [{ email: "z", keep: 1 }],
          },
        },
      },
    });
    expect(out).toEqual({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_1", amount: 100, status: "captured", list: [{ keep: 1 }] } } },
    });
  });
});

describe("isCronAuthorized", () => {
  const req = (authorization?: string) =>
    new Request("http://x/api/cron/a", { headers: authorization ? { authorization } : {} });
  it("accepts only the exact bearer secret", () => {
    expect(isCronAuthorized(req("Bearer abc"), "abc")).toBe(true);
    expect(isCronAuthorized(req(), "abc")).toBe(false);
    expect(isCronAuthorized(req("Bearer abd"), "abc")).toBe(false);
    expect(isCronAuthorized(req("abc"), "abc")).toBe(false);
    expect(isCronAuthorized(req("bearer abc"), "abc")).toBe(false);
  });
  it("rejects everything when no secret is configured", () => {
    expect(isCronAuthorized(req("Bearer "), "")).toBe(false);
    expect(isCronAuthorized(req("Bearer undefined"), null)).toBe(false);
  });
});

describe("mock provider safety", () => {
  it("refuses to be constructed in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => new MockPaymentProvider()).toThrow(PaymentConfigError);
  });

  it("the registry fails loudly in production without keys instead of falling back to the mock", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://x");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret");
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    const { getPaymentProvider, setPaymentProvider } = await import("@/server/payments/registry");
    expect(() => getPaymentProvider()).toThrow(/Razorpay is not configured/);
    expect(() => setPaymentProvider(null)).toThrow(/cannot be overridden in production/);
  });

  it("uses the mock only outside production when keys are empty, and Razorpay when they are set", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgres://x");
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    let reg = await import("@/server/payments/registry");
    expect(reg.getPaymentProvider().name).toBe("mock");

    delete (globalThis as { __ifonliPayments?: unknown }).__ifonliPayments;
    vi.resetModules();
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "shh");
    reg = await import("@/server/payments/registry");
    const p = reg.getPaymentProvider();
    expect(p.name).toBe("razorpay");
    expect(p.keyId).toBe("rzp_test_abc");
    // key secret never doubles as webhook secret: with no webhook secret every webhook is rejected
    expect(p.verifyWebhookSignature("{}", "0".repeat(64))).toBe(false);
  });

  it("mock signatures use the key secret and verify through the same domain code", () => {
    const m = new MockPaymentProvider({ deterministic: true });
    const sig = m.sign("order_1", "pay_1");
    expect(m.verifyCheckoutSignature({ razorpayOrderId: "order_1", razorpayPaymentId: "pay_1", signature: sig })).toBe(true);
    expect(m.verifyCheckoutSignature({ razorpayOrderId: "order_1", razorpayPaymentId: "pay_2", signature: sig })).toBe(false);
    expect(MOCK_KEY_SECRET).not.toBe("");
  });
});

describe("razorpay normalisers", () => {
  it("keep only non-personal payment fields", () => {
    const p = normalizeRazorpayPayment({
      id: "pay_1",
      order_id: "order_1",
      amount: "12900",
      currency: "INR",
      status: "captured",
      method: "upi",
      amount_refunded: 0,
      email: "a@b.co",
      contact: "+91999",
      vpa: "me@upi",
    } as never);
    expect(p).toEqual({
      id: "pay_1",
      orderId: "order_1",
      amountPaise: 12900,
      currency: "INR",
      status: "captured",
      method: "upi",
      captured: true,
      amountRefundedPaise: 0,
      errorCode: null,
      errorDescription: null,
    });
    expect(normalizeRazorpayPayment({ id: "p", amount: 1, currency: "INR", status: "weird" }).status).toBe("created");
  });

  it("maps refunds and tolerates Razorpay's empty-array notes", () => {
    expect(normalizeRazorpayRefund({ id: "rfnd_1", payment_id: "pay_1", amount: 500, status: "processed", notes: [] })).toMatchObject({
      status: "processed",
      notes: {},
      amountPaise: 500,
    });
    expect(normalizeRazorpayRefund({ id: "r", payment_id: "p", status: "x", notes: { refund_id: 7 } })).toMatchObject({
      status: "pending",
      notes: { refund_id: "7" },
    });
  });
});
