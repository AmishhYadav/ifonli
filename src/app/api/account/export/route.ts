import { getSession } from "@/server/auth/session";
import { isAdminRole } from "@/server/auth/permissions";
import { getDb } from "@/server/db";
import { exportCustomerData } from "@/server/services/accounts";
import { consumeRateLimit } from "@/server/services/rate-limit";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/account/export
 * The signed-in customer's data as a JSON download (DPDP right to access): profile, addresses, orders
 * and wishlist. Built from the session's own user id only; internal ids are left out.
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session || isAdminRole((session.user as { role?: string }).role)) {
    return new Response("Sign in required", { status: 401, headers: NO_STORE });
  }
  const db = getDb();
  const limit = await consumeRateLimit(db, `export:user:${session.user.id}`, {
    limit: 10,
    windowSeconds: 3600,
  });
  if (!limit.allowed) {
    return new Response("Too many requests", {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) },
    });
  }
  const data = await exportCustomerData(db, session.user.id);
  if (!data) return new Response("Not found", { status: 404, headers: NO_STORE });
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ifonli-my-data.json"',
    },
  });
}
