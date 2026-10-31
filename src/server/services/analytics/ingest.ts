import "server-only";

import { analyticsEvents } from "@/server/db/schema";
import { LIMITS } from "@/lib/analytics/events";
import { consumeRateLimit, type RateLimitRule } from "@/server/services/rate-limit";
import type { DbClient } from "@/server/services/queries/shared";

import { isLikelyBot } from "./bots";
import { eventBatchSchema, toEventRows } from "./schema";

/** Per client IP and per anonymous session. A browser batches, so a real visitor stays far below both. */
export const INGEST_IP_RULE: RateLimitRule = { limit: 90, windowSeconds: 60 };
export const INGEST_SESSION_RULE: RateLimitRule = { limit: 40, windowSeconds: 60 };

export interface IngestRequest {
  /** The raw request body text. */
  body: string;
  /** `Content-Length` header, when sent (checked before the body is trusted). */
  contentLength: number | null;
  userAgent: string | null;
  /** `Origin` header, if any. */
  origin: string | null;
  /** The site's own host (`Host` header). */
  host: string | null;
  ip: string;
  now?: Date;
}

export type IngestOutcome =
  | { status: 204; reason: "accepted" | "bot" | "empty"; commit: (() => Promise<number>) | null }
  | { status: 400 | 403 | 413; error: string }
  | { status: 429; error: string; retryAfterSeconds: number };

function originMatches(origin: string | null, host: string | null): boolean {
  if (!origin) return true; // same-origin beacons from older browsers may omit it
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Validates and rate-limits one beacon request and returns what to do next. Nothing is written here:
 * `commit` (present only when there is something to store) is run by the route inside `after()`, so
 * the insert never delays the response. Order of checks: origin, size, bot (silently ignored), JSON
 * and schema (400), rate limits (429).
 */
export async function handleEventsRequest(db: DbClient, req: IngestRequest): Promise<IngestOutcome> {
  if (!originMatches(req.origin, req.host)) return { status: 403, error: "forbidden_origin" };

  if (
    (req.contentLength !== null && req.contentLength > LIMITS.maxBodyBytes) ||
    Buffer.byteLength(req.body, "utf8") > LIMITS.maxBodyBytes
  ) {
    return { status: 413, error: "payload_too_large" };
  }

  if (isLikelyBot(req.userAgent)) return { status: 204, reason: "bot", commit: null };

  let json: unknown;
  try {
    json = JSON.parse(req.body);
  } catch {
    return { status: 400, error: "invalid_json" };
  }
  const parsed = eventBatchSchema.safeParse(json);
  if (!parsed.success) return { status: 400, error: "invalid_payload" };

  const now = req.now ?? new Date();
  const [byIp, bySession] = [
    await consumeRateLimit(db, `events:ip:${req.ip}`, INGEST_IP_RULE, now),
    await consumeRateLimit(db, `events:sid:${parsed.data.sessionId}`, INGEST_SESSION_RULE, now),
  ];
  const blocked = !byIp.allowed ? byIp : !bySession.allowed ? bySession : null;
  if (blocked) return { status: 429, error: "rate_limited", retryAfterSeconds: blocked.retryAfterSeconds };

  const rows = toEventRows(parsed.data, now);
  if (rows.length === 0) return { status: 204, reason: "empty", commit: null };
  return {
    status: 204,
    reason: "accepted",
    commit: async () => {
      await db.insert(analyticsEvents).values(rows);
      return rows.length;
    },
  };
}
