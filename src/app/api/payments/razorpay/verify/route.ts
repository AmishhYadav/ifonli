import { captureException } from "@/lib/monitoring/sentry";
import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import { dispatchOutboxSoon } from "@/server/notify/dispatch";
import { PaymentConfigError } from "@/server/payments/provider";
import { getPaymentProvider } from "@/server/payments/registry";
import { handleVerifyRequest } from "@/server/payments/verify";

const NO_STORE = { "Cache-Control": "no-store" };

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * POST { razorpay_order_id, razorpay_payment_id, razorpay_signature, ref, token }
 * Called by the Checkout.js success handler. The order is confirmed only after the signature AND the
 * provider's own record of the payment check out (see `handleVerifyRequest`).
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  try {
    const out = await handleVerifyRequest(getDb(), getPaymentProvider(), body, { ip: clientIp(req) });
    // Confirmation e-mails were queued in the same transaction; send them right after the response.
    dispatchOutboxSoon();
    if (out.productIds.length > 0) {
      try {
        revalidateStock({ productIds: out.productIds }, { via: "route" });
      } catch (e) {
        console.error("revalidateStock failed", e instanceof Error ? e.message : e);
      }
    }
    const headers: Record<string, string> = { ...NO_STORE };
    if (out.status === 429 && "retryAfterSeconds" in out.body && out.body.retryAfterSeconds) {
      headers["Retry-After"] = String(out.body.retryAfterSeconds);
    }
    return Response.json(out.body, { status: out.status, headers });
  } catch (e) {
    if (e instanceof PaymentConfigError) {
      return Response.json({ ok: false, error: "provider_unavailable" }, { status: 503, headers: NO_STORE });
    }
    console.error("payment verify failed", e instanceof Error ? e.name : "unknown");
    await captureException(e, { source: "route", route: "/api/payments/razorpay/verify" });
    return Response.json({ ok: false, error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
