import { getDb } from "@/server/db";
import { cleanupHousekeeping } from "@/server/payments/cleanup";
import { cronUnauthorized, isCronAuthorized } from "@/server/payments/cron-auth";

/** Daily housekeeping: expired carts, old processed webhook events, stale rate-limit windows. */
export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();
  try {
    return Response.json({ ok: true, ...(await cleanupHousekeeping(getDb())) });
  } catch (e) {
    console.error("cleanup failed", e instanceof Error ? e.message : "unknown");
    return Response.json({ ok: false }, { status: 500 });
  }
}
