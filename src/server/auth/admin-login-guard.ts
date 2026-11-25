import "server-only";

import { getDb } from "@/server/db";

import { adminLoginKeys } from "./login-keys";
import { consumeRateLimit, isRateLimited } from "./rate-limit";
import { alertOnLoginLocked } from "./security-alerts";

/** Every password attempt for one e-mail (right or wrong): slows a guesser down. */
export const ADMIN_LOGIN_ATTEMPT_LIMIT = { limit: 8, windowSec: 600 } as const;

/**
 * Wrong passwords for one e-mail FROM ONE ADDRESS per day. Reaching it locks that address out of the
 * account (every attempt refused, even with the right password) until the window ends; the account
 * itself stays usable from everywhere else, so a stranger who knows a staff address cannot lock the
 * real person out by guessing from their own connection.
 */
export const ADMIN_LOGIN_IP_FAILURE_LIMIT = { limit: 10, windowSec: 24 * 3600 } as const;

/**
 * Wrong passwords for one e-mail FROM ALL ADDRESSES per day: the account-wide ceiling against guessing
 * spread over many addresses (NIST SP 800-63B 5.2.2 caps consecutive failures at 100). Reaching it locks
 * the account everywhere until the window ends. Together with the 10-minute budget this caps a botnet at
 * 100 guesses per account per day, and a correct password still needs the authenticator code.
 *
 * Both windows are fixed 24-hour blocks (they reset at 05:30 IST, midnight UTC), so "locked" lasts until
 * the end of that block: up to 24 hours, sometimes much less.
 */
export const ADMIN_LOGIN_FAILURE_LIMIT = { limit: 100, windowSec: 24 * 3600 } as const;

/**
 * True when this e-mail may not try a password from `ip` now: the address has used up its budget for
 * the account, or the account has used up its account-wide budget. Read-only.
 */
export async function isAdminLoginLocked(email: string, ip: string | null, now: Date = new Date()): Promise<boolean> {
  const keys = adminLoginKeys(email, ip);
  const [account, address] = await Promise.all([
    isRateLimited(keys.failures, ADMIN_LOGIN_FAILURE_LIMIT, now),
    isRateLimited(keys.failuresFromIp, ADMIN_LOGIN_IP_FAILURE_LIMIT, now),
  ]);
  return account || address;
}

/** Counts one attempt against the 10-minute budget; false = over it (this attempt included, as with every limiter here). */
export async function consumeAdminLoginAttempt(email: string, now: Date = new Date()): Promise<boolean> {
  const res = await consumeRateLimit(adminLoginKeys(email).attempts, ADMIN_LOGIN_ATTEMPT_LIMIT, now);
  return res.allowed;
}

/**
 * Records one wrong password against both daily budgets. The attempt that uses one up locks (that
 * address, or the whole account) and, once per window and kind (a one-row gate, so racing requests
 * cannot send it twice), alerts the owners and the account holder when the address belongs to an
 * admin. The caller answers the same generic error whatever happens here, so the response never says
 * whether the account exists. Never throws for alert problems.
 */
export async function recordFailedAdminLogin(
  email: string,
  ip: string | null,
  now: Date = new Date(),
): Promise<{ locked: false } | { locked: true; scope: "account" | "address" }> {
  const keys = adminLoginKeys(email, ip);
  const [account, address] = await Promise.all([
    consumeRateLimit(keys.failures, ADMIN_LOGIN_FAILURE_LIMIT, now),
    consumeRateLimit(keys.failuresFromIp, ADMIN_LOGIN_IP_FAILURE_LIMIT, now),
  ]);
  const scope = account.remaining === 0 ? "account" : address.remaining === 0 ? "address" : null;
  if (!scope) return { locked: false };

  const decision = scope === "account" ? account : address;
  const gate = await consumeRateLimit(
    scope === "account" ? keys.lockedAlert : keys.ipLockedAlert,
    { limit: 1, windowSec: ADMIN_LOGIN_FAILURE_LIMIT.windowSec },
    now,
  );
  if (gate.allowed) {
    await alertOnLoginLocked(getDb(), {
      email: email.trim().toLowerCase(),
      ip,
      scope,
      failures: scope === "account" ? ADMIN_LOGIN_FAILURE_LIMIT.limit : ADMIN_LOGIN_IP_FAILURE_LIMIT.limit,
      lockedUntil: new Date(now.getTime() + decision.retryAfterSec * 1000),
      now,
    });
  }
  return { locked: true, scope };
}
