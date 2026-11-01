import { captureException } from "@/lib/monitoring/sentry";
import { getDb } from "@/server/db";
import { cleanupHousekeeping } from "@/server/payments/cleanup";
import { cronUnauthorized, isCronAuthorized } from "@/server/payments/cron-auth";

/** Daily housekeeping: expired carts, old processed webhook events, stale rate-limit windows, delivered e-mails older than 90 days, expired sessions and sign-in codes. */
export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();
  try {
    return Response.json({ ok: true, ...(await cleanupHousekeeping(getDb())) });
  } catch (e) {
    console.error("cleanup failed", e instanceof Error ? e.message : "unknown");
    await captureException(e, { source: "cron", route: "/api/cron/cleanup" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
