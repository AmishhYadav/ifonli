/**
 * A non-secret "this browser has a signed-in customer" hint (value `1`, readable by script). The real
 * session cookie is httpOnly and the storefront shell is static, so the device wishlist uses this
 * hint to decide whether to talk to the account at all. It grants nothing: every account action
 * checks the real session, and a stale hint just makes the first sync fail and clear itself.
 */
export const ACCOUNT_HINT_COOKIE = "ifonli_acct";
export const ACCOUNT_HINT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function hasAccountHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((part) => part.trim() === `${ACCOUNT_HINT_COOKIE}=1`);
}

export function clearAccountHint(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${ACCOUNT_HINT_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
