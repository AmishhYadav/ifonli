import "server-only";

import Razorpay from "razorpay";

import { verifyPaymentSignature, verifyWebhookSignature } from "@/server/domain";

import {
  PaymentProviderError,
  type CreateProviderOrderInput,
  type PaymentProvider,
  type ProviderOrder,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type ProviderRefund,
  type ProviderRefundInput,
  type ProviderRefundStatus,
} from "./provider";

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  /** Webhook secret from the dashboard; distinct from the key secret. May be absent (webhooks off). */
  webhookSecret?: string;
}

/** The SDK rejects with a plain `{ statusCode, error: { code, description } }`, not an Error. */
function toProviderError(e: unknown, action: string): PaymentProviderError {
  if (e instanceof PaymentProviderError) return e;
  const err = e as { statusCode?: number | string; error?: { code?: string; description?: string } } | null;
  const statusCode = Number(err?.statusCode);
  const hasStatus = Number.isFinite(statusCode) && statusCode > 0;
  // 4xx (except 429) means our request was wrong: retrying the same call will not help.
  const retryable = !hasStatus || statusCode >= 500 || statusCode === 429;
  const code = err?.error?.code;
  const description = err?.error?.description;
  return new PaymentProviderError(
    `Razorpay ${action} failed${hasStatus ? ` (${statusCode})` : ""}${code ? ` ${code}` : ""}${
      description ? `: ${description}` : ""
    }`,
    { retryable, code, statusCode: hasStatus ? statusCode : undefined },
  );
}

const PAYMENT_STATUSES: readonly ProviderPaymentStatus[] = [
  "created",
  "authorized",
  "captured",
  "refunded",
  "failed",
];

interface RawPayment {
  id: string;
  order_id?: string | null;
  amount: number | string;
  currency: string;
  status: string;
  method?: string | null;
  captured?: boolean;
  amount_refunded?: number | string | null;
  error_code?: string | null;
  error_description?: string | null;
}

/** Keeps only non-personal fields: card, VPA, e-mail and phone never leave this function. */
export function normalizeRazorpayPayment(p: RawPayment): ProviderPayment {
  const status = PAYMENT_STATUSES.includes(p.status as ProviderPaymentStatus)
    ? (p.status as ProviderPaymentStatus)
    : "created";
  return {
    id: p.id,
    orderId: p.order_id ?? null,
    amountPaise: Number(p.amount),
    currency: p.currency,
    status,
    method: p.method ?? null,
    captured: p.captured === true || status === "captured",
    amountRefundedPaise: Number(p.amount_refunded ?? 0),
    errorCode: p.error_code ?? null,
    errorDescription: p.error_description ?? null,
  };
}

interface RawRefund {
  id: string;
  payment_id: string;
  amount?: number | string;
  status: string;
  receipt?: string | null;
  notes?: Record<string, unknown> | unknown[] | null;
}

export function normalizeRazorpayRefund(r: RawRefund): ProviderRefund {
  const status: ProviderRefundStatus =
    r.status === "processed" || r.status === "failed" ? r.status : "pending";
  const notes: Record<string, string> = {};
  // Razorpay returns `[]` instead of `{}` when there are no notes.
  if (r.notes && !Array.isArray(r.notes)) {
    for (const [k, v] of Object.entries(r.notes)) notes[k] = String(v);
  }
  return {
    id: r.id,
    paymentId: r.payment_id,
    amountPaise: Number(r.amount ?? 0),
    status,
    receipt: r.receipt ?? null,
    notes,
  };
}

export function createRazorpayProvider(creds: RazorpayCredentials): PaymentProvider {
  const client = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });

  async function call<T>(action: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw toProviderError(e, action);
    }
  }

  return {
    name: "razorpay",
    keyId: creds.keyId,

    async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
      const o = await call("create order", () =>
        client.orders.create({
          amount: input.amountPaise,
          currency: "INR",
          receipt: input.receipt,
          notes: input.notes,
        }),
      );
      return {
        id: o.id,
        amountPaise: Number(o.amount),
        currency: o.currency,
        receipt: o.receipt ?? null,
        status: o.status === "paid" || o.status === "attempted" ? o.status : "created",
      };
    },

    async fetchPayment(paymentId) {
      const p = await call("fetch payment", () => client.payments.fetch(paymentId));
      return normalizeRazorpayPayment(p as unknown as RawPayment);
    },

    async fetchOrderPayments(providerOrderId) {
      const r = await call("fetch order payments", () => client.orders.fetchPayments(providerOrderId));
      return (r.items as unknown as RawPayment[]).map(normalizeRazorpayPayment);
    },

    async capture(paymentId, amountPaise) {
      const p = await call("capture payment", () =>
        client.payments.capture(paymentId, amountPaise, "INR"),
      );
      return normalizeRazorpayPayment(p as unknown as RawPayment);
    },

    async refund(paymentId, input: ProviderRefundInput) {
      const r = await call("refund payment", () =>
        client.payments.refund(paymentId, {
          amount: input.amountPaise,
          speed: "normal",
          receipt: input.receipt,
          notes: input.notes,
        }),
      );
      return normalizeRazorpayRefund(r as unknown as RawRefund);
    },

    async listRefunds(paymentId) {
      const r = await call("list refunds", () => client.payments.fetchMultipleRefund(paymentId));
      return (r.items as unknown as RawRefund[]).map(normalizeRazorpayRefund);
    },

    verifyCheckoutSignature({ razorpayOrderId, razorpayPaymentId, signature }) {
      return verifyPaymentSignature({
        razorpayOrderId,
        razorpayPaymentId,
        signature,
        keySecret: creds.keySecret,
      });
    },

    verifyWebhookSignature(rawBody, signature) {
      return verifyWebhookSignature({
        rawBody,
        signature,
        webhookSecret: creds.webhookSecret ?? "",
      });
    },
  };
}
