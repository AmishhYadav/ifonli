import { z } from "zod";

import { ForbiddenError, requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getInvoiceDownloadUrl, InvoiceError } from "@/server/services/invoices";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/admin/orders/{id}/invoice: redirects to a short-lived signed link to the invoice PDF.
 * Needs a signed-in admin with `order:invoice` (owner, admin and fulfilment hold it).
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/admin/orders/[id]/invoice">): Promise<Response> {
  try {
    await requireAdmin("order:invoice", { denied: "throw" });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Forbidden", { status: 403, headers: NO_STORE });
    throw error;
  }
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404, headers: NO_STORE });
  try {
    const { url } = await getInvoiceDownloadUrl(getDb(), id);
    return new Response(null, { status: 302, headers: { ...NO_STORE, Location: url } });
  } catch (e) {
    if (e instanceof InvoiceError) {
      return new Response(e.message, { status: e.code === "order_not_found" ? 404 : 409, headers: NO_STORE });
    }
    console.error("admin invoice failed", e instanceof Error ? e.message : "unknown");
    return new Response("Could not prepare the invoice", { status: 500, headers: NO_STORE });
  }
}
