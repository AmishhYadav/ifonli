import { getDb } from "@/server/db";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { getInvoiceDownloadUrl, InvoiceError } from "@/server/services/invoices";
import { getOrderForCustomer } from "@/server/services/orders";

const NO_STORE = { "Cache-Control": "private, no-store" };

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * GET /api/orders/{ref}/invoice?t={access token}
 * The same guest check as the order page (`getOrderForCustomer`): an unknown ref, a missing token
 * and a wrong token are all the same 404. On success the browser is redirected to a short-lived
 * signed link to the invoice PDF in the private bucket.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/orders/[ref]/invoice">): Promise<Response> {
  const { ref } = await ctx.params;
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const db = getDb();

  const limit = await consumeRateLimit(db, `invoice:ip:${clientIp(req)}`, { limit: 30, windowSeconds: 600 });
  if (!limit.allowed) {
    return new Response("Too many requests", {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const order = await getOrderForCustomer(db, ref, token);
  if (!order) return new Response("Not found", { status: 404, headers: NO_STORE });

  try {
    const { url } = await getInvoiceDownloadUrl(db, order.id);
    return new Response(null, { status: 302, headers: { ...NO_STORE, Location: url } });
  } catch (e) {
    if (e instanceof InvoiceError) return new Response("Invoice not available yet", { status: 404, headers: NO_STORE });
    console.error("customer invoice failed", e instanceof Error ? e.message : "unknown");
    return new Response("Could not prepare the invoice", { status: 500, headers: NO_STORE });
  }
}
