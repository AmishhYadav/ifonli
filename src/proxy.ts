import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { clientIpFromHeaders, isIpAllowed, parseAllowedIps, type IpRule } from "@/lib/ip-allowlist";

/**
 * Coarse gate for /admin/** and /api/admin/**, two checks in order:
 *
 * 1. Optional IP allow-list (`ADMIN_ALLOWED_IPS`, OFF when unset). A request from an address that is
 *    not in the list gets a plain 404 (not a redirect, not the login page), so the admin is
 *    invisible to everyone else. The client IP is the first entry of `x-forwarded-for`, else
 *    `x-real-ip`; on Vercel the platform overwrites `x-forwarded-for` with the real client address
 *    (a client-supplied header is never passed through), so it cannot be spoofed there. A list that
 *    cannot be parsed, or a request with no usable client address, is refused: the filter fails closed.
 * 2. Pages only: no session cookie means /admin/login. This only checks that a cookie exists (the
 *    proxy cannot afford, and should not do, a database lookup); the real checks (valid session,
 *    admin role, TOTP enrolled, permissions) run in `requireAdmin()` in every admin layout, page and
 *    Server Action, and in every /api/admin route handler (the proxy adds only the IP filter there).
 *
 * The matcher is scoped to the admin so the static storefront is untouched.
 */
const COOKIE_PREFIX = "ifonli"; // keep in sync with AUTH_COOKIE_PREFIX in src/server/auth/auth.ts

/** Parsed `ADMIN_ALLOWED_IPS`, memoised per raw value (null = filter off, [] = refuse everyone). */
let cachedAllowList: { raw: string; rules: IpRule[] | null } | undefined;

function adminAllowList(): IpRule[] | null {
  const raw = process.env.ADMIN_ALLOWED_IPS?.trim() ?? "";
  if (cachedAllowList?.raw === raw) return cachedAllowList.rules;
  let rules: IpRule[] | null = null;
  if (raw !== "") {
    const parsed = parseAllowedIps(raw);
    if (parsed.invalid.length > 0) {
      // The boot check refuses such a value in production; this is the backstop for any other run.
      console.error("ADMIN_ALLOWED_IPS is invalid; refusing every admin request until it is fixed");
      rules = [];
    } else {
      rules = parsed.rules;
    }
  }
  cachedAllowList = { raw, rules };
  return rules;
}

function notFound(): NextResponse {
  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const allowList = adminAllowList();
  if (allowList && !isIpAllowed(clientIpFromHeaders(request.headers), allowList)) return notFound();

  const isApi = pathname === "/api/admin" || pathname.startsWith("/api/admin/");
  if (!isApi) {
    const isLogin = pathname === "/admin/login";
    const hasSession = !!getSessionCookie(request, { cookiePrefix: COOKIE_PREFIX });
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
  matcher: ["/admin", "/admin/:path*", "/api/admin", "/api/admin/:path*"],
};
