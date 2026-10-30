import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import { PaymentConfigError } from "@/server/payments/provider";
import { getPaymentProvider } from "@/server/payments/registry";
import { handleRazorpayWebhook } from "@/server/payments/webhook";

/**
 * Razorpay webhook. The signature covers the RAW body, so it is read with `req.text()` and never
 * re-serialised. Responses carry no internal detail.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    const out = await handleRazorpayWebhook(getDb(), getPaymentProvider(), {
      rawBody,
      signature: req.headers.get("x-razorpay-signature"),
      eventId: req.headers.get("x-razorpay-event-id"),
    });
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
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
