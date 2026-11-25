import "server-only";

import { createHash } from "node:crypto";

import { and, eq, lt, sql } from "drizzle-orm";

import { rateLimits } from "@/server/db/schema";

import type { DbClient } from "./queries/shared";

export interface RateLimitRule {
  /** Attempts allowed per window. */
  limit: number;
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts left in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the window resets (always >= 1). */
  retryAfterSeconds: number;
}

/**
 * Fixed-window limiter on `rate_limits` (plan 13). One atomic upsert per attempt, so it is correct
 * across serverless instances. The attempt is counted even when it is rejected. Keys are free-form
 * (`coupon:ip:1.2.3.4`); use one call per dimension (IP, cart) you want to limit.
 */
export async function consumeRateLimit(
  db: DbClient,
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  const count = row?.count ?? 1;
  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000)),
  };
}

/**
 * Gives one attempt back (a no-op at zero): for budgets that count something that did not end up
 * happening, such as an order whose payment could not be started. Pass the same `now` the attempt
 * was counted with so the same window is hit.
 */
export async function releaseRateLimit(
  db: DbClient,
  key: string,
  rule: Pick<RateLimitRule, "windowSeconds">,
  now: Date = new Date(),
): Promise<void> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  await db
    .update(rateLimits)
    .set({ count: sql`greatest(${rateLimits.count} - 1, 0)` })
    .where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, windowStart)));
}

/**
 * Short stable digest for rate-limit keys, so personal data (an e-mail, a phone number) and secrets
 * (the cart token) are never stored in `rate_limits`.
 */
export function digestKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Housekeeping: deletes windows that started before `olderThan`. Returns the rows removed. */
export async function pruneRateLimits(db: DbClient, olderThan: Date): Promise<number> {
  const deleted = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, olderThan))
    .returning({ key: rateLimits.key });
  return deleted.length;
}
