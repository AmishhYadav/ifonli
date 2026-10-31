import "server-only";

import { getRequestIp } from "@/features/cart/request";
import { getDb } from "@/server/db";
import {
  consumeRateLimit,
  type RateLimitDecision,
  type RateLimitRule,
} from "@/server/services/rate-limit";

/**
 * Per-IP limiter for public Server Actions. Returns the decision, or `null` when the limiter itself
 * failed (database trouble): public READ actions fail open on that (the action's own query would fail
 * anyway), mutating actions should treat `null` as an error. Use one named scope per action
 * (`search`, `wishlist`, `cart`...) so the keys in `rate_limits` stay readable.
 */
export async function limitByIp(
  scope: string,
  rule: RateLimitRule,
): Promise<RateLimitDecision | null> {
  try {
    return await consumeRateLimit(getDb(), `${scope}:ip:${await getRequestIp()}`, rule);
  } catch (error) {
    console.error(
      `rate limit "${scope}" unavailable`,
      error instanceof Error ? error.message : "unknown",
    );
    return null;
  }
}
