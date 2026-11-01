import { captureException } from "@/lib/monitoring/sentry";
import { getDb } from "@/server/db";
import { cleanupHousekeeping } from "@/server/payments/cleanup";
import { cronUnauthorized, isCronAuthorized } from "@/server/payments/cron-auth";

export const maxDuration = 120;

/**
 * Daily housekeeping: expired carts, old processed webhook events, stale rate-limit windows, delivered
 * e-mails, expired sessions and sign-in codes, and the personal-data retention steps
 * (`services/retention.ts`: closed contact messages, closed support cases, orphaned support photos).
 */
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
