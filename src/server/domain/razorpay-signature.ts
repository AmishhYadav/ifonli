/**
 * Razorpay signature checks (plan 7.6). The two secrets are NOT interchangeable:
 *  - checkout/payment signature: HMAC-SHA256(`${orderId}|${paymentId}`, KEY SECRET)
 *  - webhook signature:          HMAC-SHA256(rawBody,                    WEBHOOK SECRET)
 * Both are lower-case hex, compared in constant time, and return false (never throw) on bad input.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const HEX64 = /^[0-9a-fA-F]{64}$/;

function hmacHex(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function safeEqualHex(expectedHex: string, presented: unknown): boolean {
  if (typeof presented !== "string" || !HEX64.test(presented)) {
    return false;
  }
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(presented, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export interface PaymentSignatureInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
  /** Razorpay API key secret (NOT the webhook secret). */
  keySecret: string;
}

export function verifyPaymentSignature(input: PaymentSignatureInput): boolean {
  const { razorpayOrderId, razorpayPaymentId, signature, keySecret } = input;
  if (!nonEmpty(razorpayOrderId) || !nonEmpty(razorpayPaymentId) || !nonEmpty(keySecret)) {
    return false;
  }
  return safeEqualHex(hmacHex(`${razorpayOrderId}|${razorpayPaymentId}`, keySecret), signature);
}

export interface WebhookSignatureInput {
  /** The exact request body string (`await req.text()`), never re-serialised JSON. */
  rawBody: string;
  /** `X-Razorpay-Signature` header. */
  signature: string;
  /** Webhook secret configured in the Razorpay dashboard (NOT the key secret). */
  webhookSecret: string;
}

export function verifyWebhookSignature(input: WebhookSignatureInput): boolean {
  const { rawBody, signature, webhookSecret } = input;
  if (typeof rawBody !== "string" || !nonEmpty(webhookSecret)) {
    return false;
  }
  return safeEqualHex(hmacHex(rawBody, webhookSecret), signature);
}

export class AmountMismatchError extends Error {
  override name = "AmountMismatchError";
  constructor(
    readonly expectedPaise: number,
    readonly gatewayAmountPaise: unknown,
  ) {
    super(
      `Gateway amount ${String(gatewayAmountPaise)} does not match expected ${expectedPaise} paise`,
    );
  }
}

/**
 * Throws unless both amounts are safe integers (paise) and equal. Razorpay reports `amount` in
 * paise; a fractional or non-numeric value is treated as a mismatch, never coerced.
 */
export function assertAmountMatches(expectedPaise: number, gatewayAmountPaise: number): void {
  if (
    !Number.isSafeInteger(expectedPaise) ||
    !Number.isSafeInteger(gatewayAmountPaise) ||
    expectedPaise !== gatewayAmountPaise
  ) {
    throw new AmountMismatchError(expectedPaise, gatewayAmountPaise);
  }
}
