import { getDb } from "@/server/db";
import { queueLowStockDigest } from "@/server/notify/low-stock";
import { processOutbox } from "@/server/notify/sender";
import { NotifyConfigError } from "@/server/notify/channel";
import { cronUnauthorized, isCronAuthorized } from "@/server/payments/cron-auth";

/** Daily at 09:00 IST (03:30 UTC): one admin e-mail listing low and sold-out variants; skipped when none. */
export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();
  try {
    const db = getDb();
    const queued = await queueLowStockDigest(db);
    // Send straight away; the notify-retry cron is the backstop if this fails.
    const sent = queued.recipients > 0 ? await processOutbox(db, { limit: 25 }) : null;
    return Response.json({ ok: true, ...queued, sent: sent?.sent ?? 0 });
  } catch (e) {
    if (e instanceof NotifyConfigError) return Response.json({ ok: false, error: "email_not_configured" }, { status: 503 });
    console.error("low-stock-digest failed", e instanceof Error ? e.name : "unknown");
    return Response.json({ ok: false }, { status: 500 });
  }
}
