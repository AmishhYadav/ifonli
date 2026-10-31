import { getDb } from "@/server/db";
import { cronUnauthorized, isCronAuthorized } from "@/server/payments/cron-auth";
import { runAnalyticsRollup } from "@/server/services/analytics/rollup";

/**
 * Hourly: rebuilds `product_engagement_daily` for the last 3 India days from the raw events (idempotent),
 * then deletes raw events older than the retention setting. `?days=N` (1-90) rebuilds further back, for a
 * backfill after an outage.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();
  try {
    const requested = Number(new URL(req.url).searchParams.get("days"));
    const result = await runAnalyticsRollup(getDb(), {
      days: Number.isFinite(requested) && requested >= 1 ? requested : undefined,
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("analytics-rollup failed", e instanceof Error ? e.message : "unknown");
    return Response.json({ ok: false }, { status: 500 });
  }
}
