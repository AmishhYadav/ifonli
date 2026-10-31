import { z } from "zod";

import { captureException, parseDsn, readReporterEnv } from "@/lib/monitoring/sentry";
import { getDb } from "@/server/db";
import { clientIpFromHeaders, readTextLimited } from "@/server/security/request";
import { consumeRateLimit } from "@/server/services/rate-limit";

/**
 * POST /api/monitoring: tunnel for browser error reports (see src/lib/monitoring/client.ts). It does
 * nothing at all (204, no database access) unless SENTRY_DSN is set. Public, so: 8 KB body cap, strict
 * schema, per-IP Postgres rate limit, and the payload is scrubbed again before it leaves the server.
 * The browser can only choose message / stack / page path: tags, release and environment are ours.
 */
const MAX_BODY_BYTES = 8 * 1024;
const LIMIT = { limit: 20, windowSeconds: 600 } as const;

const bodySchema = z.object({
  source: z.enum(["client", "client-unhandled-rejection", "client-boundary"]),
  name: z.string().max(80).optional(),
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  url: z.string().max(300).optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!parseDsn(readReporterEnv().dsn)) return new Response(null, { status: 204 });
  try {
    const limit = await consumeRateLimit(
      getDb(),
      `monitoring:ip:${clientIpFromHeaders(req.headers)}`,
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
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return new Response(null, { status: 400 });

    const { source, name, message, stack, url } = parsed.data;
    const error = new Error(message);
    error.name = name ?? "Error";
    if (stack) error.stack = stack;
    await captureException(error, { source, ...(url ? { url } : {}) }, "javascript");
  } catch (e) {
    console.error("monitoring tunnel failed", e instanceof Error ? e.message : "unknown");
  }
  return new Response(null, { status: 204 });
}
