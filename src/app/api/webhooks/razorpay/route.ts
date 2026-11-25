import { captureException } from "@/lib/monitoring/sentry";
import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import { dispatchOutboxSoon } from "@/server/notify/dispatch";
import { PaymentConfigError } from "@/server/payments/provider";
import { getPaymentProvider } from "@/server/payments/registry";
import { handleRazorpayWebhook, MAX_WEBHOOK_BYTES } from "@/server/payments/webhook";
import { readTextLimited } from "@/server/security/request";

/**
 * Razorpay webhook. The signature covers the RAW body, so it is read as exact UTF-8 text
 * (`readTextLimited`, capped at `MAX_WEBHOOK_BYTES` while streaming: 413 above that, before anything
 * is buffered) and never re-serialised. Responses carry no internal detail.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const rawBody = await readTextLimited(req, MAX_WEBHOOK_BYTES);
    if (rawBody === null) return Response.json({ error: "too_large" }, { status: 413 });
    const out = await handleRazorpayWebhook(getDb(), getPaymentProvider(), {
      rawBody,
      signature: req.headers.get("x-razorpay-signature"),
      eventId: req.headers.get("x-razorpay-event-id"),
    });
    // Confirmation / refund e-mails were queued in the same transaction; send them right after the response.
    dispatchOutboxSoon();
    if (out.productIds.length > 0) {
      try {
        revalidateStock({ productIds: out.productIds }, { via: "route" });
      } catch (e) {
        console.error("revalidateStock failed", e instanceof Error ? e.message : e);
      }
    }
    return Response.json(out.body, { status: out.status });
  } catch (e) {
    if (e instanceof PaymentConfigError) return Response.json({ error: "unavailable" }, { status: 503 });
    console.error("razorpay webhook crashed", e instanceof Error ? e.name : "unknown");
    await captureException(e, { source: "webhook", route: "/api/webhooks/razorpay" });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
