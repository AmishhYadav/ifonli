/**
 * Pure helpers for the `next` redirect parameter of the account login. No server imports, so the
 * client form, Server Actions and unit tests share one rule: only same-origin paths are followed.
 */

export const ACCOUNT_HOME = "/account";
export const ACCOUNT_LOGIN = "/account/login";

/**
 * A same-origin path to go to after signing in, or `fallback`. Rejects anything that could leave
 * the site (absolute URLs, `//host` even once dot segments are collapsed, `/\host`, other schemes),
 * control characters, and the login page itself (which would loop).
 */
export function safeNextPath(raw: unknown, fallback: string = ACCOUNT_HOME): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (value.length === 0 || value.length > 500) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(value, "http://ifonli.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://ifonli.invalid") return fallback;
  // The URL parser collapses dot segments, so `/.//evil.com` and `/a/..//evil.com` come out as
  // `//evil.com`, which a browser reads as another host. Judge the path that will be returned.
  if (url.pathname.startsWith("//")) return fallback;
  if (url.pathname === ACCOUNT_LOGIN || url.pathname.startsWith(`${ACCOUNT_LOGIN}/`)) return fallback;
  return `${url.pathname}${url.search}`;
}

/** `/account/login` with optional `next` and prefilled `email`. */
export function accountLoginUrl(opts: { next?: string | null; email?: string | null } = {}): string {
  const params = new URLSearchParams();
  const next = opts.next ? safeNextPath(opts.next, "") : "";
  if (next && next !== ACCOUNT_HOME) params.set("next", next);
  if (opts.email) params.set("email", opts.email);
  const query = params.toString();
  return query ? `${ACCOUNT_LOGIN}?${query}` : ACCOUNT_LOGIN;
}
