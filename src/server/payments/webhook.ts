import "server-only";

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { payments, webhookEvents } from "@/server/db/schema";
import { AmountMismatchError } from "@/server/domain";
import {
  finalizePaidOrder,
  PaymentFlowError,
  recordPaymentFailure,
} from "@/server/services/payments";
import type { DbClient } from "@/server/services/queries/shared";
import { reconcileProviderRefund } from "@/server/services/refunds";

import { confirmProviderPayment } from "./confirm";
import type { PaymentProvider } from "./provider";
import { normalizeRazorpayRefund } from "./razorpay";
import { sanitizeWebhookPayload } from "./sanitize";

export const MAX_WEBHOOK_BYTES = 256 * 1024;

export interface WebhookRequest {
  /** `await req.text()`: the exact bytes the signature covers. */
  rawBody: string;
  /** `X-Razorpay-Signature` */
  signature: string | null;
  /** `x-razorpay-event-id` */
  eventId: string | null;
}

export type WebhookOutcome =
  | { status: 200; body: { ok: true; duplicate?: boolean; ignored?: boolean }; productIds: string[] }
  | { status: 400 | 401 | 413 | 500; body: { error: string }; productIds: [] };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
function entity(payload: unknown, key: string): Json | null {
  if (!isObj(payload)) return null;
  const holder = payload[key];
  if (!isObj(holder)) return null;
  const e = holder.entity;
  return isObj(e) ? e : null;
}
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** What happened to one event: used for `webhook_events.error` and the response. */
interface Handled {
  productIds: string[];
  /** A permanent, logged condition (e.g. unknown order). Recorded, answered 2xx so Razorpay stops retrying. */
  note?: string;
}

class TransientWebhookError extends Error {}

async function handlePaymentCaptured(db: DbClient, provider: PaymentProvider, payload: unknown, now: Date): Promise<Handled> {
  const pay = entity(payload, "payment");
  const order = entity(payload, "order");
  const paymentId = str(pay?.id);
  const providerOrderId = str(pay?.order_id) ?? str(order?.id);
  if (!paymentId || !providerOrderId) return { productIds: [], note: "missing_ids" };

  const [row] = await db.select().from(payments).where(eq(payments.providerOrderId, providerOrderId)).limit(1);
  if (!row) return { productIds: [], note: "unknown_order" };

  // The payload is signed, but the capture is still confirmed with the provider (plan 7.6).
  const confirmed = await confirmProviderPayment(provider, paymentId, providerOrderId);
  if (!confirmed.ok) {
    if (confirmed.reason === "provider_error") throw new TransientWebhookError("provider_unavailable");
    return { productIds: [], note: confirmed.reason };
  }
  try {
    const r = await finalizePaidOrder(db, row.orderId, confirmed.payment, { now, provider });
    return { productIds: r.productIds };
  } catch (e) {
    if (e instanceof AmountMismatchError) return { productIds: [], note: "amount_mismatch" };
    if (e instanceof PaymentFlowError) return { productIds: [], note: e.code };
    throw e;
  }
}

async function handlePaymentFailed(db: DbClient, payload: unknown): Promise<Handled> {
  const pay = entity(payload, "payment");
  const order = entity(payload, "order");
  const paymentId = str(pay?.id);
  const providerOrderId = str(pay?.order_id) ?? str(order?.id);
  if (!paymentId || !providerOrderId) return { productIds: [], note: "missing_ids" };
  const r = await recordPaymentFailure(db, {
    providerOrderId,
    providerPaymentId: paymentId,
    method: str(pay?.method),
    errorCode: str(pay?.error_code),
    errorDescription: str(pay?.error_description)?.slice(0, 200) ?? null,
  });
  return { productIds: [], note: r.orderId ? undefined : "unknown_order" };
}

async function handleRefund(db: DbClient, payload: unknown): Promise<Handled> {
  const r = entity(payload, "refund");
  if (!r || !str(r.id) || !str(r.payment_id)) return { productIds: [], note: "missing_ids" };
  await reconcileProviderRefund(
    db,
    normalizeRazorpayRefund({
      id: r.id as string,
      payment_id: r.payment_id as string,
      amount: r.amount as number,
      status: String(r.status ?? "pending"),
      receipt: str(r.receipt),
      notes: isObj(r.notes) ? r.notes : null,
    }),
  );
  return { productIds: [] };
}

/**
 * Razorpay webhook (plan 7.6): signature over the RAW body with the webhook secret, dedupe on the
 * `x-razorpay-event-id` header through `webhook_events`, then act. 2xx means "stop retrying":
 *  - bad signature -> 401, no side effects, nothing stored;
 *  - replay of a processed event -> 200 `duplicate`;
 *  - permanent oddities (unknown order, amount mismatch) -> recorded in `error`, 200;
 *  - transient failures (database, provider down) -> 500 so Razorpay retries (nothing leaks).
 */
export async function handleRazorpayWebhook(
  db: DbClient,
  provider: PaymentProvider,
  req: WebhookRequest,
  now: Date = new Date(),
): Promise<WebhookOutcome> {
  if (req.rawBody.length > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: "too_large" }, productIds: [] };
  if (!req.signature || !provider.verifyWebhookSignature(req.rawBody, req.signature)) {
    return { status: 401, body: { error: "invalid_signature" }, productIds: [] };
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(req.rawBody);
  } catch {
    return { status: 400, body: { error: "invalid_json" }, productIds: [] };
  }
  if (!isObj(envelope) || typeof envelope.event !== "string") {
    return { status: 400, body: { error: "invalid_event" }, productIds: [] };
  }
  const event = envelope.event;
  const eventId = req.eventId?.trim() || `sha256:${createHash("sha256").update(req.rawBody).digest("hex")}`;

  // Dedupe: the unique provider_event_id decides who processes the event.
  const [inserted] = await db
    .insert(webhookEvents)
    .values({ providerEventId: eventId, type: event.slice(0, 64), payload: sanitizeWebhookPayload(envelope) as Json })
    .onConflictDoNothing({ target: webhookEvents.providerEventId })
    .returning({ id: webhookEvents.id });
  let rowId = inserted?.id;
  if (!rowId) {
    const [existing] = await db.select().from(webhookEvents).where(eq(webhookEvents.providerEventId, eventId));
    if (!existing) return { status: 500, body: { error: "internal" }, productIds: [] };
    if (existing.processedAt) return { status: 200, body: { ok: true, duplicate: true }, productIds: [] };
    rowId = existing.id; // an earlier delivery crashed or failed transiently: process it now
  }

  try {
    let handled: Handled;
    switch (event) {
      case "payment.captured":
      case "payment.authorized":
      case "order.paid":
        handled = await handlePaymentCaptured(db, provider, envelope.payload, now);
        break;
      case "payment.failed":
        handled = await handlePaymentFailed(db, envelope.payload);
        break;
      case "refund.processed":
      case "refund.failed":
        handled = await handleRefund(db, envelope.payload);
        break;
      default:
        handled = { productIds: [], note: "ignored_event" };
    }
    await db
      .update(webhookEvents)
      .set({ processedAt: now, error: handled.note ?? null })
      .where(eq(webhookEvents.id, rowId));
    return {
      status: 200,
      body: { ok: true, ...(handled.note === "ignored_event" ? { ignored: true } : {}) },
      productIds: handled.productIds,
    };
  } catch (e) {
    // Never log the payload (personal data); the error text is enough to find the event row.
    console.error("razorpay webhook failed", { event, eventId, error: e instanceof Error ? e.name : "unknown" });
    try {
      await db
        .update(webhookEvents)
        .set({ error: (e instanceof Error ? `${e.name}: ${e.message}` : "unknown").slice(0, 300) })
        .where(eq(webhookEvents.id, rowId));
    } catch {
      /* the event row stays unprocessed; the retry will pick it up */
    }
    return { status: 500, body: { error: "internal" }, productIds: [] };
  }
}
