import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AmountMismatchError,
  assertAmountMatches,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "@/server/domain";

const KEY_SECRET = "test_key_secret_aaaaaaaa";
const WEBHOOK_SECRET = "test_webhook_secret_bbbbbbbb";
const hmac = (msg: string, secret: string) =>
  createHmac("sha256", secret).update(msg).digest("hex");

describe("verifyPaymentSignature", () => {
  const orderId = "order_TEST123";
  const paymentId = "pay_TEST456";
  const signature = hmac(`${orderId}|${paymentId}`, KEY_SECRET);
  const input = {
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    signature,
    keySecret: KEY_SECRET,
  };

  it("accepts a valid signature", () => {
    expect(verifyPaymentSignature(input)).toBe(true);
    expect(verifyPaymentSignature({ ...input, signature: signature.toUpperCase() })).toBe(true);
  });

  it("rejects tampered ids or signature", () => {
    expect(verifyPaymentSignature({ ...input, razorpayOrderId: "order_OTHER" })).toBe(false);
    expect(verifyPaymentSignature({ ...input, razorpayPaymentId: "pay_OTHER" })).toBe(false);
    const flipped = (signature.startsWith("0") ? "1" : "0") + signature.slice(1);
    expect(verifyPaymentSignature({ ...input, signature: flipped })).toBe(false);
  });

  it("is order-sensitive (payment|order is wrong)", () => {
    expect(
      verifyPaymentSignature({ ...input, signature: hmac(`${paymentId}|${orderId}`, KEY_SECRET) }),
    ).toBe(false);
  });

  it("rejects the webhook secret (secrets are not interchangeable)", () => {
    expect(verifyPaymentSignature({ ...input, keySecret: WEBHOOK_SECRET })).toBe(false);
    const withWebhookSecret = hmac(`${orderId}|${paymentId}`, WEBHOOK_SECRET);
    expect(verifyPaymentSignature({ ...input, signature: withWebhookSecret })).toBe(false);
  });

  it("returns false on malformed input without throwing", () => {
    expect(verifyPaymentSignature({ ...input, signature: "" })).toBe(false);
    expect(verifyPaymentSignature({ ...input, signature: signature.slice(0, 40) })).toBe(false);
    expect(verifyPaymentSignature({ ...input, signature: `${signature}ab` })).toBe(false);
    expect(verifyPaymentSignature({ ...input, signature: "g".repeat(64) })).toBe(false);
    expect(verifyPaymentSignature({ ...input, signature: undefined as unknown as string })).toBe(
      false,
    );
    expect(verifyPaymentSignature({ ...input, razorpayOrderId: "" })).toBe(false);
    expect(verifyPaymentSignature({ ...input, razorpayPaymentId: "" })).toBe(false);
    expect(verifyPaymentSignature({ ...input, keySecret: "" })).toBe(false);
    expect(verifyPaymentSignature({ ...input, keySecret: undefined as unknown as string })).toBe(
      false,
    );
  });
});

describe("verifyWebhookSignature", () => {
  const rawBody =
    '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_X","amount":12900}}}}';
  const signature = hmac(rawBody, WEBHOOK_SECRET);
  const input = { rawBody, signature, webhookSecret: WEBHOOK_SECRET };

  it("accepts a valid signature over the raw body", () => {
    expect(verifyWebhookSignature(input)).toBe(true);
  });

  it("rejects a tampered body, including whitespace-only changes", () => {
    expect(verifyWebhookSignature({ ...input, rawBody: rawBody.replace("12900", "100") })).toBe(
      false,
    );
    expect(verifyWebhookSignature({ ...input, rawBody: `${rawBody} ` })).toBe(false);
    expect(
      verifyWebhookSignature({ ...input, rawBody: JSON.stringify(JSON.parse(rawBody), null, 2) }),
    ).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const flipped = (signature.startsWith("a") ? "b" : "a") + signature.slice(1);
    expect(verifyWebhookSignature({ ...input, signature: flipped })).toBe(false);
  });

  it("rejects the key secret (secrets are not interchangeable)", () => {
    expect(verifyWebhookSignature({ ...input, webhookSecret: KEY_SECRET })).toBe(false);
    expect(verifyWebhookSignature({ ...input, signature: hmac(rawBody, KEY_SECRET) })).toBe(false);
  });

  it("returns false on malformed input without throwing", () => {
    expect(verifyWebhookSignature({ ...input, signature: "" })).toBe(false);
    expect(verifyWebhookSignature({ ...input, signature: "abc" })).toBe(false);
    expect(verifyWebhookSignature({ ...input, signature: "x".repeat(64) })).toBe(false);
    expect(verifyWebhookSignature({ ...input, signature: null as unknown as string })).toBe(false);
    expect(verifyWebhookSignature({ ...input, webhookSecret: "" })).toBe(false);
    expect(verifyWebhookSignature({ ...input, rawBody: undefined as unknown as string })).toBe(
      false,
    );
  });

  it("accepts an empty body when signed (edge case, not an error)", () => {
    expect(
      verifyWebhookSignature({
        rawBody: "",
        signature: hmac("", WEBHOOK_SECRET),
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toBe(true);
  });
});

describe("assertAmountMatches", () => {
  it("passes on equal integer paise", () => {
    expect(() => assertAmountMatches(12900, 12900)).not.toThrow();
    expect(() => assertAmountMatches(0, 0)).not.toThrow();
  });

  it("throws a typed error on mismatch", () => {
    expect(() => assertAmountMatches(12900, 12899)).toThrow(AmountMismatchError);
    try {
      assertAmountMatches(12900, 100);
    } catch (e) {
      expect(e).toBeInstanceOf(AmountMismatchError);
      expect((e as AmountMismatchError).expectedPaise).toBe(12900);
      expect((e as AmountMismatchError).gatewayAmountPaise).toBe(100);
    }
  });

  it("never coerces fractions or non-numbers", () => {
    expect(() => assertAmountMatches(12900, 12900.5)).toThrow(AmountMismatchError);
    expect(() => assertAmountMatches(129.5, 129.5)).toThrow(AmountMismatchError);
    expect(() => assertAmountMatches(12900, Number.NaN)).toThrow(AmountMismatchError);
    expect(() => assertAmountMatches(12900, "12900" as unknown as number)).toThrow(
      AmountMismatchError,
    );
    expect(() =>
      assertAmountMatches(Number.MAX_SAFE_INTEGER + 2, Number.MAX_SAFE_INTEGER + 2),
    ).toThrow(AmountMismatchError);
  });
});
