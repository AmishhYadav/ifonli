import { createHash } from "node:crypto";

/**
 * Pure helpers for the keys of the Postgres rate limiter (`rate_limits.key`), shared by the auth
 * guards and the admin sign-in action. No database, no `server-only`, so they are unit-testable.
 */

/** Short sha256 digest for a rate-limit key: the key is stable per value but never holds the value (an e-mail, an IP). */
export const keyDigest = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);

/** Canonical form of an e-mail address for keys: trimmed and lower-cased, so `Boss@x.com` and `boss@x.com` share one budget. */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Rate-limit keys of one e-mail address for the admin password sign-in. All start with `admin-login-`
 * (the e2e helper empties `admin-%`, and an owner unlocks an account by deleting `admin-login-%`
 * rows, see RUNBOOK section 8). The address is hashed, never stored raw in `rate_limits`.
 */
export function adminLoginKeys(
  email: string,
  ip?: string | null,
): { attempts: string; failures: string; failuresFromIp: string; lockedAlert: string; ipLockedAlert: string } {
  const d = keyDigest(normaliseEmail(email));
  return {
    /** Every attempt (right or wrong password), short window: slows a guesser down. */
    attempts: `admin-login-email:${d}`,
    /** Wrong passwords from ANY address, 24 h window: the account-wide ceiling against spread-out guessing. */
    failures: `admin-login-fail:${d}`,
    /**
     * Wrong passwords from ONE address, 24 h window: locks that address out of this account long before
     * the account-wide ceiling, so a single stranger cannot lock the real person out.
     */
    failuresFromIp: `admin-login-fail-ip:${d}:${keyDigest(ip ?? "unknown")}`,
    /** One-shot gate so the "account locked" alert is sent once per window, not once per racing request. */
    lockedAlert: `admin-login-locked-alert:${d}`,
    /** Same, for the first address locked out of this account in a window. */
    ipLockedAlert: `admin-login-ip-locked-alert:${d}`,
  };
}
