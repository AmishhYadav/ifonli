/** Guest order-access tokens (plan 7.11). The raw token is emailed; only its SHA-256 is stored. */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface AccessToken {
  /** 32 random bytes, base64url (43 chars). */
  token: string;
  /** SHA-256 of `token`, lower-case hex (64 chars). */
  hash: string;
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createAccessToken(): AccessToken {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashAccessToken(token) };
}

const HEX64 = /^[0-9a-fA-F]{64}$/;

/** Constant-time check of a presented token against the stored hash. Never throws. */
export function verifyAccessToken(token: string, hash: string): boolean {
  if (
    typeof token !== "string" ||
    typeof hash !== "string" ||
    token.length === 0 ||
    !HEX64.test(hash)
  ) {
    return false;
  }
  const actual = Buffer.from(hashAccessToken(token), "hex");
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
