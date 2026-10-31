import { verifyAccessToken } from "@/server/domain";

/**
 * Guest order-access tokens (plan 7.11). `orders.access_token_hash` holds the SHA-256 of the token in
 * the `?t=` link. A repeated submit of the same checkout has to hand the customer a usable token, but
 * the raw token cannot be recovered from its hash, so each replay adds a new hash instead of replacing
 * the old one: the link from the first tab keeps working. The column keeps the newest few,
 * space-separated (hex never contains a space).
 */
export const MAX_ORDER_TOKEN_HASHES = 5;

/** Constant-time check of a presented token against every stored hash (no early exit). */
export function orderTokenMatches(token: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  let ok = false;
  for (const hash of stored.split(" ")) {
    if (verifyAccessToken(token, hash)) ok = true;
  }
  return ok;
}

/** The stored value after adding `hash`: the newest `MAX_ORDER_TOKEN_HASHES` hashes. */
export function addOrderTokenHash(stored: string | null | undefined, hash: string): string {
  const all = (stored ?? "").split(" ").filter(Boolean);
  return [...all, hash].slice(-MAX_ORDER_TOKEN_HASHES).join(" ");
}
