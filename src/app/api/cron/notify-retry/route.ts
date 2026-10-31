import { getDb } from "@/server/db";
import { NotifyConfigError } from "@/server/notify/channel";
import { processOutbox } from "@/server/notify/sender";
import { cronUnauthorized, isCronAuthorized } from "@/server/payments/cron-auth";

/**
 * Every 5 minutes: sends due outbox rows (first tries missed by the after-response dispatch, and
 * retries with backoff). The backstop that makes delivery eventually happen.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();
  try {
    const result = await processOutbox(getDb(), { limit: 100 });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof NotifyConfigError) {
      console.error("notify-retry: e-mail is not configured");
      return Response.json({ ok: false, error: "email_not_configured" }, { status: 503 });
    }
    console.error("notify-retry failed", e instanceof Error ? e.name : "unknown");
    return Response.json({ ok: false }, { status: 500 });
  }
}
