import { getSession } from "@/server/auth/session";
import { isAdminRole } from "@/server/auth/permissions";
import { getDb } from "@/server/db";
import { findOwnedOrderId } from "@/server/services/accounts";
import { getInvoiceDownloadUrl, InvoiceError } from "@/server/services/invoices";
import { consumeRateLimit } from "@/server/services/rate-limit";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/account/orders/{ref}/invoice
 * The signed-in owner's invoice. Ownership is the session's user id against `orders.user_id`: someone
 * else's ref, a guest order and an unknown ref are all the same 404. On success the browser is sent
 * to a short-lived signed link to the PDF in the private bucket (same as the guest route).
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/account/orders/[ref]/invoice">,
): Promise<Response> {
  const session = await getSession();
  if (!session || isAdminRole((session.user as { role?: string }).role)) {
    return new Response("Sign in required", { status: 401, headers: NO_STORE });
  }
  const { ref } = await ctx.params;
  const db = getDb();

  const limit = await consumeRateLimit(db, `invoice:user:${session.user.id}`, {
    limit: 30,
    windowSeconds: 600,
  });
  if (!limit.allowed) {
    return new Response("Too many requests", {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const orderId = await findOwnedOrderId(db, session.user.id, decodeURIComponent(ref));
  if (!orderId) return new Response("Not found", { status: 404, headers: NO_STORE });

  try {
    const { url } = await getInvoiceDownloadUrl(db, orderId);
    return new Response(null, { status: 302, headers: { ...NO_STORE, Location: url } });
  } catch (e) {
    if (e instanceof InvoiceError) {
      return new Response("Invoice not available yet", { status: 404, headers: NO_STORE });
    }
    console.error("account invoice failed", e instanceof Error ? e.message : "unknown");
    return new Response("Could not prepare the invoice", { status: 500, headers: NO_STORE });
  }
}
