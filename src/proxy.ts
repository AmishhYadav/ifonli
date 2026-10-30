import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Coarse gate for /admin/**: no session cookie means /admin/login. This only checks that a cookie
 * exists (the proxy cannot afford, and should not do, a database lookup); the real checks (valid
 * session, admin role, TOTP enrolled, permissions) run in `requireAdmin()` in every admin layout,
 * page and Server Action. The matcher is scoped to /admin so the static storefront is untouched.
 */
const COOKIE_PREFIX = "ifonli"; // keep in sync with AUTH_COOKIE_PREFIX in src/server/auth/auth.ts

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/admin/login";
  const hasSession = !!getSessionCookie(request, { cookiePrefix: COOKIE_PREFIX });

  if (!hasSession && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
