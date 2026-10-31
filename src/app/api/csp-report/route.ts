import { getDb } from "@/server/db";
import { summariseCspReports } from "@/server/security/csp-report";
import { clientIpFromHeaders, readTextLimited } from "@/server/security/request";
import { consumeRateLimit } from "@/server/services/rate-limit";

/**
 * POST /api/csp-report: receives CSP violation reports (report-uri and Reporting API). Public by
 * nature, so it is rate limited per IP (a page with one broken directive can send several reports per
 * view), the body is capped at 16 KB, and only a compact, URL-stripped summary is logged. It answers
 * with an empty body and never echoes input.
 */
const MAX_BODY_BYTES = 16 * 1024;
const LIMIT = { limit: 60, windowSeconds: 600 } as const;

export async function POST(req: Request): Promise<Response> {
  try {
    const limit = await consumeRateLimit(
      getDb(),
      `csp:ip:${clientIpFromHeaders(req.headers)}`,
      LIMIT,
    );
    if (!limit.allowed) {
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }
    const text = await readTextLimited(req, MAX_BODY_BYTES);
    if (text === null) return new Response(null, { status: 413 });

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }
    for (const report of summariseCspReports(payload)) {
      console.warn(
        `[csp] ${report.disposition} ${report.directive} blocked=${report.blocked} page=${report.page}` +
          (report.source ? ` src=${report.source}${report.line ? `:${report.line}` : ""}` : ""),
      );
    }
  } catch (e) {
    // Never fail loudly: browsers do not retry, and a broken report endpoint must not become an error storm.
    console.error("csp-report failed", e instanceof Error ? e.message : "unknown");
  }
  return new Response(null, { status: 204 });
}
