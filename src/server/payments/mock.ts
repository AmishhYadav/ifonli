import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { verifyPaymentSignature, verifyWebhookSignature } from "@/server/domain";

import {
  PaymentConfigError,
  PaymentProviderError,
  type CreateProviderOrderInput,
  type PaymentProvider,
  type ProviderOrder,
  type ProviderPayment,
  type ProviderRefund,
  type ProviderRefundInput,
} from "./provider";

/**
 * In-memory, DB-free stand-in for Razorpay. Used by the integration tests (injected explicitly) and
 * by local development when the Razorpay keys are empty (see `registry.ts`).
 *
 * It can never run in production: the constructor throws when `NODE_ENV === "production"`, and the
 * registry never selects it there. Its secrets are public constants, so a signature produced by this
 * file would be worthless against the real verifier (different key).
 */
export const MOCK_KEY_ID = "rzp_test_mock_ifonli";
export const MOCK_KEY_SECRET = "mock_key_secret_not_for_production";
export const MOCK_WEBHOOK_SECRET = "mock_webhook_secret_not_for_production";

export interface MockPaymentOptions {
  /** Sequential ids (`order_mock_000001`) for assertions. Random otherwise, so a dev restart never reuses an id. */
  deterministic?: boolean;
}

export type MockOperation =
  | "createOrder"
  | "fetchPayment"
  | "fetchOrderPayments"
  | "capture"
  | "refund"
  | "listRefunds";

export type MockWebhookEvent =
  | "payment.captured"
  | "payment.authorized"
  | "payment.failed"
  | "order.paid"
  | "refund.processed"
  | "refund.failed";

export interface MockWebhook {
  rawBody: string;
  signature: string;
  eventId: string;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;
  readonly keyId = MOCK_KEY_ID;

  readonly orders = new Map<string, ProviderOrder & { notes: Record<string, string> }>();
  readonly payments = new Map<string, ProviderPayment>();
  readonly refunds = new Map<string, ProviderRefund>();
  /** Calls made, in order, e.g. `refund:pay_mock_000001:12900` (for assertions). */
  readonly calls: string[] = [];
  /** Status the next refunds are created with. */
  refundStatus: "pending" | "processed" = "processed";

  private seq = { order: 0, pay: 0, refund: 0, event: 0 };
  private readonly failures = new Map<MockOperation, number>();

  constructor(private readonly options: MockPaymentOptions = {}) {
    if (process.env.NODE_ENV === "production") {
      throw new PaymentConfigError("The mock payment provider cannot be used in production.");
    }
  }

  /** Makes the next `times` calls of `op` throw a retryable provider error. */
  failNext(op: MockOperation, times = 1): void {
    this.failures.set(op, times);
  }

  private guard(op: MockOperation, detail = ""): void {
    this.calls.push(detail ? `${op}:${detail}` : op);
    const left = this.failures.get(op) ?? 0;
    if (left > 0) {
      this.failures.set(op, left - 1);
      throw new PaymentProviderError(`Mock provider: injected ${op} failure`, { retryable: true });
    }
  }

  private id(prefix: "order" | "pay" | "rfnd"): string {
    const key = prefix === "rfnd" ? "refund" : prefix;
    this.seq[key] += 1;
    const suffix = this.options.deterministic
      ? String(this.seq[key]).padStart(6, "0")
      : randomBytes(7).toString("hex");
    return `${prefix}_mock_${suffix}`;
  }

  /* ----------------------------------------------------------------------------------------- */
  /* PaymentProvider                                                                           */
  /* ----------------------------------------------------------------------------------------- */

  async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    this.guard("createOrder", String(input.amountPaise));
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 100) {
      throw new PaymentProviderError("Mock provider: amount must be at least 100 paise", {
        retryable: false,
      });
    }
    const order = {
      id: this.id("order"),
      amountPaise: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
      status: "created" as const,
      notes: input.notes,
    };
    this.orders.set(order.id, order);
    return order;
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    this.guard("fetchPayment", paymentId);
    const p = this.payments.get(paymentId);
    if (!p) throw new PaymentProviderError("Mock provider: payment not found", { retryable: false, statusCode: 400 });
    return { ...p };
  }

  async fetchOrderPayments(providerOrderId: string): Promise<ProviderPayment[]> {
    this.guard("fetchOrderPayments", providerOrderId);
    return [...this.payments.values()].filter((p) => p.orderId === providerOrderId).map((p) => ({ ...p }));
  }

  async capture(paymentId: string, amountPaise: number): Promise<ProviderPayment> {
    this.guard("capture", `${paymentId}:${amountPaise}`);
    const p = this.payments.get(paymentId);
    if (!p) throw new PaymentProviderError("Mock provider: payment not found", { retryable: false, statusCode: 400 });
    if (p.status !== "authorized") {
      throw new PaymentProviderError("Mock provider: payment is not in authorized state", {
        retryable: false,
        statusCode: 400,
      });
    }
    if (amountPaise !== p.amountPaise) {
      throw new PaymentProviderError("Mock provider: capture amount must equal the authorized amount", {
        retryable: false,
        statusCode: 400,
      });
    }
    p.status = "captured";
    p.captured = true;
    return { ...p };
  }

  async refund(paymentId: string, input: ProviderRefundInput): Promise<ProviderRefund> {
    this.guard("refund", `${paymentId}:${input.amountPaise}`);
    const p = this.payments.get(paymentId);
    if (!p || !p.captured) {
      throw new PaymentProviderError("Mock provider: only captured payments can be refunded", {
        retryable: false,
        statusCode: 400,
      });
    }
    if (input.amountPaise <= 0 || input.amountPaise > p.amountPaise - p.amountRefundedPaise) {
      throw new PaymentProviderError("Mock provider: refund exceeds the refundable amount", {
        retryable: false,
        statusCode: 400,
      });
    }
    p.amountRefundedPaise += input.amountPaise;
    const refund: ProviderRefund = {
      id: this.id("rfnd"),
      paymentId,
      amountPaise: input.amountPaise,
      status: this.refundStatus,
      receipt: input.receipt,
      notes: { ...input.notes },
    };
    this.refunds.set(refund.id, refund);
    return { ...refund };
  }

  async listRefunds(paymentId: string): Promise<ProviderRefund[]> {
    this.guard("listRefunds", paymentId);
    return [...this.refunds.values()].filter((r) => r.paymentId === paymentId).map((r) => ({ ...r }));
  }

  verifyCheckoutSignature(input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    signature: string;
  }): boolean {
    return verifyPaymentSignature({ ...input, keySecret: MOCK_KEY_SECRET });
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    return verifyWebhookSignature({ rawBody, signature, webhookSecret: MOCK_WEBHOOK_SECRET });
  }

  /* ----------------------------------------------------------------------------------------- */
  /* Simulation controls (tests and the dev-only mock checkout)                                */
  /* ----------------------------------------------------------------------------------------- */

  /**
   * Plays the customer paying on Razorpay's side: records a payment against `providerOrderId` and
   * returns it. `amountPaise` defaults to the order amount (override it to test tampering).
   */
  simulatePayment(
    providerOrderId: string,
    opts: {
      status?: "captured" | "authorized" | "failed";
      amountPaise?: number;
      method?: string;
    } = {},
  ): ProviderPayment {
    const order = this.orders.get(providerOrderId);
    if (!order) throw new Error(`Mock provider: unknown order ${providerOrderId}`);
    const status = opts.status ?? "captured";
    const payment: ProviderPayment = {
      id: this.id("pay"),
      orderId: providerOrderId,
      amountPaise: opts.amountPaise ?? order.amountPaise,
      currency: "INR",
      status,
      method: opts.method ?? "upi",
      captured: status === "captured",
      amountRefundedPaise: 0,
      errorCode: status === "failed" ? "BAD_REQUEST_ERROR" : null,
      errorDescription: status === "failed" ? "Payment failed (mock)" : null,
    };
    this.payments.set(payment.id, payment);
    order.status = status === "captured" ? "paid" : "attempted";
    return { ...payment };
  }

  /**
   * Dev only: re-registers an order this process no longer remembers (server restart between
   * placing the order and paying), using the amount stored in our `payments` row.
   */
  registerOrder(providerOrderId: string, amountPaise: number): void {
    if (this.orders.has(providerOrderId)) return;
    this.orders.set(providerOrderId, {
      id: providerOrderId,
      amountPaise,
      currency: "INR",
      receipt: null,
      status: "created",
      notes: {},
    });
  }

  /** A valid Checkout.js `razorpay_signature` for the pair. */
  sign(razorpayOrderId: string, razorpayPaymentId: string): string {
    return createHmac("sha256", MOCK_KEY_SECRET).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  }

  /** The three fields Checkout.js hands to its `handler` on success. */
  checkoutResponse(payment: ProviderPayment): {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  } {
    const orderId = payment.orderId ?? "";
    return {
      razorpay_order_id: orderId,
      razorpay_payment_id: payment.id,
      razorpay_signature: this.sign(orderId, payment.id),
    };
  }

  /** A signed webhook delivery in Razorpay's wire format. Pass `eventId` to replay one. */
  buildWebhook(
    event: MockWebhookEvent,
    subject: { payment?: ProviderPayment; refund?: ProviderRefund },
    eventId?: string,
  ): MockWebhook {
    const payload: Record<string, unknown> = {};
    if (subject.payment) {
      const p = subject.payment;
      payload.payment = {
        entity: {
          id: p.id,
          entity: "payment",
          order_id: p.orderId,
          amount: p.amountPaise,
          currency: p.currency,
          status: p.status,
          method: p.method,
          captured: p.captured,
          amount_refunded: p.amountRefundedPaise,
          error_code: p.errorCode,
          error_description: p.errorDescription,
        },
      };
      const o = p.orderId ? this.orders.get(p.orderId) : undefined;
      if (o) {
        payload.order = {
          entity: { id: o.id, entity: "order", amount: o.amountPaise, currency: o.currency, receipt: o.receipt, status: o.status },
        };
      }
    }
    if (subject.refund) {
      const r = subject.refund;
      payload.refund = {
        entity: {
          id: r.id,
          entity: "refund",
          payment_id: r.paymentId,
          amount: r.amountPaise,
          currency: "INR",
          status: r.status,
          receipt: r.receipt,
          notes: r.notes,
        },
      };
    }
    const rawBody = JSON.stringify({
      entity: "event",
      account_id: "acc_mock",
      event,
      contains: Object.keys(payload),
      payload,
      created_at: Math.floor(Date.now() / 1000),
    });
    this.seq.event += 1;
    return {
      rawBody,
      signature: createHmac("sha256", MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex"),
      eventId: eventId ?? `evt_mock_${this.options.deterministic ? String(this.seq.event).padStart(6, "0") : randomBytes(7).toString("hex")}`,
    };
  }
}
