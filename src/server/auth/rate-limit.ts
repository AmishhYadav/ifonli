import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/server/db";
import { rateLimits } from "@/server/db/schema";

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts left in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the window resets. */
  retryAfterSec: number;
}

/**
 * Fixed-window limiter on the `rate_limits` table (one atomic upsert per attempt, so it is correct
 * across serverless instances). Used by the admin login actions: Better Auth's own limiter does not
 * see `auth.api.*` calls made from Server Actions.
 */
export async function consumeRateLimit(
  key: string,
  opts: { limit: number; windowSec: number },
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowMs = opts.windowSec * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await getDb()
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  const count = row?.count ?? 1;
  const retryAfterSec = Math.max(
    1,
    Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000),
  );
  return {
    allowed: count <= opts.limit,
    remaining: Math.max(0, opts.limit - count),
    retryAfterSec,
  };
}
