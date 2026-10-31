import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Coarse gates, cookie-existence only (the proxy cannot afford, and should not do, a database
 * lookup). The real checks (valid session, role, TOTP, permissions) run in `requireAdmin()` /
 * `requireCustomer()` in every layout, page and Server Action.
 *
 * - /admin/**: no session cookie means /admin/login.
 * - /account/**: no session cookie means /account/login?next=<where you were going>. The login page
 *   and the admin-session notice are open.
 *
 * The matcher is scoped to these two areas so the static storefront is untouched.
 */
const COOKIE_PREFIX = "ifonli"; // keep in sync with AUTH_COOKIE_PREFIX in src/server/auth/auth.ts

/** Open pages inside /account (kept in sync with `LOGIN_PATH` / `ADMIN_SESSION_NOTICE_PATH`). */
const OPEN_ACCOUNT_PATHS = new Set(["/account/login", "/account/admin-session"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = !!getSessionCookie(request, { cookiePrefix: COOKIE_PREFIX });

  if (pathname === "/account" || pathname.startsWith("/account/")) {
    if (!hasSession && !OPEN_ACCOUNT_PATHS.has(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/account/login";
      url.search = "";
      url.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
  } else {
    const isLogin = pathname === "/admin/login";
    if (!hasSession && !isLogin) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/account", "/account/:path*"],
};
