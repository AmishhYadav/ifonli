import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { orders, payments } from "@/server/db/schema";
import {
  AmountMismatchError,
  customerStatusLabel,
  hashAccessToken,
  normalizeOrderRef,
  verifyAccessToken,
} from "@/server/domain";
import { finalizePaidOrder, PaymentFlowError, type FinalizeResult } from "@/server/services/payments";
import type { DbClient } from "@/server/services/queries/shared";
import { consumeRateLimit } from "@/server/services/rate-limit";

import { confirmProviderPayment } from "./confirm";
import type { PaymentProvider } from "./provider";

export const verifyBodySchema = z.object({
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(128),
  ref: z.string().min(1).max(32),
  token: z.string().min(1).max(128),
});

/** What the checkout UI needs after paying. `outcome: "refunded"` = paid but the items sold out. */
export interface VerifyResponseBody {
  ok: true;
  outcome: "confirmed" | "already_paid" | "refunded";
  order: {
    ref: string;
    status: string;
    paymentStatus: string;
    statusLabel: string;
    paid: boolean;
  };
}

export type VerifyErrorCode =
  | "invalid_request"
  | "rate_limited"
  | "not_found"
  | "invalid_signature"
  | "amount_mismatch"
  | "payment_not_captured"
  | "provider_unavailable";

export type VerifyOutcome =
  | { status: 200; body: VerifyResponseBody; productIds: string[] }
  | { status: 400 | 404 | 409 | 429 | 502; body: { ok: false; error: VerifyErrorCode; retryAfterSeconds?: number }; productIds: [] };

const DUMMY_HASH = hashAccessToken("ifonli-no-such-order");

function failure(status: 400 | 404 | 409 | 429 | 502, error: VerifyErrorCode, retryAfterSeconds?: number): VerifyOutcome {
  return { status, body: { ok: false, error, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }, productIds: [] };
}

/**
 * Checkout.js success handler -> server (plan 7.6). In order: shape, rate limit, order + guest token
 * (constant time), HMAC signature with the KEY secret, the provider order must be one of ours, THEN the
 * payment is fetched from the provider and must be `captured` (authorized ones are captured through
 * the API), and only then `finalizePaidOrder`. The browser's word is never enough.
 */
export async function handleVerifyRequest(
  db: DbClient,
  provider: PaymentProvider,
  rawBody: unknown,
  ctx: { ip: string; now?: Date },
): Promise<VerifyOutcome> {
  const parsed = verifyBodySchema.safeParse(rawBody);
  if (!parsed.success) return failure(400, "invalid_request");
  const b = parsed.data;
  const ref = normalizeOrderRef(b.ref);

  const decisions = await Promise.all([
    consumeRateLimit(db, `payverify:ip:${ctx.ip}`, { limit: 40, windowSeconds: 600 }, ctx.now),
    consumeRateLimit(db, `payverify:ref:${ref}`, { limit: 20, windowSeconds: 600 }, ctx.now),
  ]);
  const blocked = decisions.find((d) => !d.allowed);
  if (blocked) return failure(429, "rate_limited", blocked.retryAfterSeconds);

  const [order] = await db.select().from(orders).where(eq(orders.ref, ref)).limit(1);
  const tokenOk = verifyAccessToken(b.token, order?.accessTokenHash ?? DUMMY_HASH);
  if (!order || !order.accessTokenHash || !tokenOk) return failure(404, "not_found");

  const signatureOk = provider.verifyCheckoutSignature({
    razorpayOrderId: b.razorpay_order_id,
    razorpayPaymentId: b.razorpay_payment_id,
    signature: b.razorpay_signature,
  });
  if (!signatureOk) return failure(400, "invalid_signature");

  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.providerOrderId, b.razorpay_order_id)))
    .limit(1);
  if (!row) return failure(404, "not_found");

  const confirmed = await confirmProviderPayment(provider, b.razorpay_payment_id, b.razorpay_order_id);
  if (!confirmed.ok) {
    if (confirmed.reason === "provider_error") return failure(502, "provider_unavailable");
    if (confirmed.reason === "order_mismatch") return failure(400, "invalid_signature");
    return failure(409, "payment_not_captured");
  }

  let result: FinalizeResult;
  try {
    result = await finalizePaidOrder(db, order.id, confirmed.payment, { now: ctx.now, provider });
  } catch (e) {
    if (e instanceof AmountMismatchError) return failure(400, "amount_mismatch");
    if (e instanceof PaymentFlowError) return failure(404, "not_found");
    throw e;
  }

  const [fresh] = await db.select().from(orders).where(eq(orders.id, order.id));
  const o = fresh ?? order;
  return {
    status: 200,
    productIds: result.productIds,
    body: {
      ok: true,
      outcome:
        result.outcome === "finalized" ? "confirmed" : result.outcome === "already_paid" ? "already_paid" : "refunded",
      order: {
        ref: o.ref,
        status: o.status,
        paymentStatus: o.paymentStatus,
        statusLabel: customerStatusLabel(o),
        paid: o.paidAt !== null,
      },
    },
  };
}
