/**
 * Payment-provider port (plan 7.5-7.8). Everything in `services/payments.ts`, `services/refunds.ts`
 * and the route handlers talks to this interface, never to the Razorpay SDK directly, so the whole
 * payment flow is testable with the in-memory mock (`mock.ts`).
 *
 * Money is integer paise on both sides of the port. Implementations normalise the provider's
 * payloads into these shapes and strip personal data (card, VPA, e-mail, phone) before anything
 * can be stored.
 */

export type ProviderName = "razorpay" | "mock";

export interface ProviderOrder {
  id: string;
  amountPaise: number;
  currency: string;
  receipt: string | null;
  status: "created" | "attempted" | "paid";
}

export type ProviderPaymentStatus = "created" | "authorized" | "captured" | "refunded" | "failed";

export interface ProviderPayment {
  id: string;
  /** Provider order the payment was made against (null for payments without an order). */
  orderId: string | null;
  amountPaise: number;
  currency: string;
  status: ProviderPaymentStatus;
  method: string | null;
  captured: boolean;
  amountRefundedPaise: number;
  errorCode: string | null;
  errorDescription: string | null;
}

export type ProviderRefundStatus = "pending" | "processed" | "failed";

export interface ProviderRefund {
  id: string;
  paymentId: string;
  amountPaise: number;
  status: ProviderRefundStatus;
  receipt: string | null;
  /** `notes` echoed back by the provider (used to find our refund row after a crash). */
  notes: Record<string, string>;
}

export interface CreateProviderOrderInput {
  amountPaise: number;
  /** Our order ref (max 40 chars). */
  receipt: string;
  notes: Record<string, string>;
}

export interface ProviderRefundInput {
  amountPaise: number;
  /** Our `refunds.id`, so a retry can recognise a refund that already went through. */
  receipt: string;
  notes: Record<string, string>;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  /** Public key id for Checkout.js. Never the secret. */
  readonly keyId: string;
  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder>;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
  /** All payment attempts made against a provider order. */
  fetchOrderPayments(providerOrderId: string): Promise<ProviderPayment[]>;
  /** Captures an `authorized` payment for exactly `amountPaise`. */
  capture(paymentId: string, amountPaise: number): Promise<ProviderPayment>;
  refund(paymentId: string, input: ProviderRefundInput): Promise<ProviderRefund>;
  listRefunds(paymentId: string): Promise<ProviderRefund[]>;
  /** HMAC(order_id|payment_id) with the KEY secret, constant time. */
  verifyCheckoutSignature(input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    signature: string;
  }): boolean;
  /** HMAC(raw body) with the WEBHOOK secret (a different secret), constant time. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

/** A failure talking to the provider. `message` is safe to log; it never carries credentials. */
export class PaymentProviderError extends Error {
  override name = "PaymentProviderError";
  constructor(
    message: string,
    readonly opts: { retryable: boolean; code?: string; statusCode?: number } = { retryable: true },
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.opts.retryable;
  }
}

/** Payments are not configured for this environment (production without Razorpay keys). */
export class PaymentConfigError extends Error {
  override name = "PaymentConfigError";
}
