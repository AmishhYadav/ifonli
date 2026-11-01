import "server-only";

import { createHash } from "node:crypto";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, emailOTP, twoFactor } from "better-auth/plugins";

import { getServerEnv } from "@/lib/env";
import { getDb } from "@/server/db";
import * as schema from "@/server/db/schema";

import { sendOtp } from "./otp-sender";
import { getPasswordChangeState } from "./admin-user";
import { isAuthApiError } from "./api-error";
import { consumeRateLimit, isRateLimited } from "./rate-limit";
import { ADMIN_ROLES, DEFAULT_ROLE, ac, authRoles, isAdminRole } from "./permissions";

/** Cookie prefix shared by Better Auth and `proxy.ts` (cookie name: `ifonli.session_token`). */
export const AUTH_COOKIE_PREFIX = "ifonli";

/** Paths of the emailOTP plugin that must never work for an admin account (D-AUTH-1). */
function isEmailOtpPath(path: string | undefined): boolean {
  return (
    !!path &&
    (path.startsWith("/email-otp/") ||
      path === "/sign-in/email-otp" ||
      path === "/forget-password/email-otp")
  );
}

/**
 * The only Better Auth endpoints reachable over HTTP (`/api/auth/*`). The app never uses Better
 * Auth's browser client: every sign-in, OTP, two-factor and account action is a Server Action that
 * calls `auth.api.*` in-process, where our own limits and audit rows apply. So the HTTP door stays
 * shut for everything else; that also means a stranger cannot probe which emails are staff (all
 * refused paths answer the same 404) or guess passwords, codes and TOTP outside our rate limits.
 */
const HTTP_ALLOWED_PATHS = new Set(["/get-session", "/sign-out", "/ok", "/error"]);

/** Sign-in codes per email address per 10 minutes (resends included): stops one inbox being mail-bombed. */
const OTP_SEND_EMAIL_LIMIT = { limit: 5, windowSec: 600 } as const;
/** Sign-in codes per IP per 10 minutes, across all addresses. */
const OTP_SEND_IP_LIMIT = { limit: 20, windowSec: 600 } as const;
/**
 * Wrong sign-in codes, counted per (email, IP) and per IP; only failures count, and sending a code
 * never touches this budget. Keyed with the IP so a stranger who knows an address cannot use up the
 * real owner's attempts (Better Auth also locks each code after 5 wrong tries).
 */
const OTP_FAIL_EMAIL_IP_LIMIT = { limit: 8, windowSec: 600 } as const;
const OTP_FAIL_IP_LIMIT = { limit: 30, windowSec: 600 } as const;

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);

function requestIp(ctx: { headers?: Headers | null }): string | null {
  const forwarded = ctx.headers?.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || ctx.headers?.get("x-real-ip") || null;
}

function failedOtpKeys(ctx: { headers?: Headers | null }, email: string) {
  const ip = requestIp(ctx) ?? "unknown";
  return [
    { key: `otp-fail:${digest(email)}:${digest(ip)}`, rule: OTP_FAIL_EMAIL_IP_LIMIT },
    { key: `otp-fail-ip:${digest(ip)}`, rule: OTP_FAIL_IP_LIMIT },
  ];
}

const tooMany = (message: string) => new APIError("TOO_MANY_REQUESTS", { message });

/**
 * D-AUTH-1 guards, run before the endpoint:
 *  - over HTTP only `HTTP_ALLOWED_PATHS` exist (see there);
 *  - credential sign-in (`/sign-in/email`) is refused unless the account holds an admin role
 *    (customers are passwordless), or while its temporary password is past its deadline; the error is
 *    the same as a wrong password so nobody can probe which emails exist or what role they have;
 *  - every emailOTP endpoint is refused for admin roles (Better Auth's two-factor hook does not
 *    fire on `/sign-in/email-otp`, so an OTP sign-in would skip TOTP);
 *  - sending a code is limited per email address and per IP; entering a code is limited by wrong
 *    attempts only (the count is recorded in `afterGuards`);
 *  - the admin plugin's own endpoints (`/admin/*`) need a TOTP-enrolled session (and are not
 *    reachable over HTTP at all: staff changes go through `services/admin/users.ts`, which audits them).
 * Admin password and TOTP guessing is limited where the Server Actions call these endpoints
 * (`app/admin/(auth)/actions.ts`: per IP and per email) and by Better Auth's per-account TOTP lockout.
 */
const guards = createAuthMiddleware(async (ctx) => {
  const path = ctx.path;
  if (ctx.request && !(path && HTTP_ALLOWED_PATHS.has(path))) {
    throw new APIError("NOT_FOUND", { message: "Not found" });
  }
  const body = ctx.body as { email?: unknown } | undefined;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;

  if (path === "/sign-in/email") {
    const found = email ? await ctx.context.internalAdapter.findUserByEmail(email) : null;
    if (found && !isAdminRole((found.user as { role?: string }).role)) {
      throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
    }
    if (found && (await getPasswordChangeState(getDb(), found.user.id)).state === "expired") {
      throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
    }
    return;
  }

  if (isEmailOtpPath(path)) {
    if (email && path === "/email-otp/send-verification-otp") {
      const ip = requestIp(ctx);
      const decisions = await Promise.all([
        consumeRateLimit(`otp-send:${digest(email)}`, OTP_SEND_EMAIL_LIMIT),
        ip ? consumeRateLimit(`otp-send-ip:${digest(ip)}`, OTP_SEND_IP_LIMIT) : null,
      ]);
      if (decisions.some((d) => d && !d.allowed)) {
        throw tooMany("Too many sign-in codes requested. Please wait a few minutes and try again.");
      }
    }
    if (email && path === "/sign-in/email-otp") {
      const blocked = await Promise.all(failedOtpKeys(ctx, email).map((k) => isRateLimited(k.key, k.rule)));
      if (blocked.some(Boolean)) {
        throw tooMany("Too many wrong codes. Please wait a few minutes and try again.");
      }
    }
    const found = email ? await ctx.context.internalAdapter.findUserByEmail(email) : null;
    if (found && isAdminRole((found.user as { role?: string }).role)) {
      throw new APIError("FORBIDDEN", {
        message: "Admin accounts sign in with a password and an authenticator code",
      });
    }
    return;
  }

  if (path?.startsWith("/admin/")) {
    const session = await getSessionFromCtx(ctx);
    if (session && !session.user.twoFactorEnabled) {
      throw new APIError("FORBIDDEN", { message: "Set up two-factor authentication first" });
    }
  }
});

/** Records a wrong sign-in code against the failed-attempt budgets that `guards` checks. */
const afterGuards = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/sign-in/email-otp" || !isAuthApiError(ctx.context.returned)) return;
  const body = ctx.body as { email?: unknown } | undefined;
  if (typeof body?.email !== "string") return;
  const email = body.email.trim().toLowerCase();
  await Promise.all(failedOtpKeys(ctx, email).map((k) => consumeRateLimit(k.key, k.rule)));
});

/**
 * Better Auth instance (server only). The HTTP handler is mounted at `src/app/api/auth/[...all]`.
 *
 * - `emailOTP`: passwordless login for customers. Delivery goes through `sendOtp`
 *   (console in dev, Resend in Phase 5).
 * - `emailAndPassword`: admins only (D-AUTH-1). Public sign-up is off; admins are created with
 *   `scripts/create-admin.ts` and the credential sign-in is refused for the `customer` role.
 * - `admin`: roles `owner | admin | fulfilment | customer` (default `customer`), with the access
 *   control built from `permissions.ts`.
 * - `twoFactor`: TOTP. Credential sign-in of an enrolled admin returns `twoFactorRedirect`; a
 *   not-yet-enrolled admin gets a session that `requireAdmin` confines to /admin/enroll-2fa.
 * - `nextCookies` (must be last): lets Server Actions that call `auth.api.*` set the cookies.
 * - HTTP: only `HTTP_ALLOWED_PATHS` answer over `/api/auth/*`; everything else is a Server Action.
 * - Rate limit: Better Auth's limiter only sees requests through the HTTP handler (not
 *   `auth.api.*` calls from our Server Actions). Its counters live in Postgres (`rate_limits`, via
 *   `customStorage`) because the default in-memory store is per serverless instance and so useless on
 *   Vercel. The admin login Server Actions and the OTP send / wrong-code limits in the guards use the
 *   same Postgres limiter (`rate-limit.ts`).
 *
 * Lazy so that importing this module during `next build` never needs a database.
 */
function createAuth() {
  const env = getServerEnv();
  return betterAuth({
    appName: "IfOnli",
    baseURL: env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    advanced: { cookiePrefix: AUTH_COOKIE_PREFIX },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      // Shared across instances. Keys are prefixed so they never collide with the app's own limiter keys.
      customStorage: {
        async consume(key, rule) {
          const res = await consumeRateLimit(`ba:${key}`, { limit: rule.max, windowSec: rule.window });
          return { allowed: res.allowed, retryAfter: res.allowed ? null : res.retryAfterSec };
        },
      },
    },
    hooks: { before: guards, after: afterGuards },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        sendVerificationOnSignUp: false,
        async sendVerificationOTP({ email, otp, type }) {
          await sendOtp({ email, otp, type });
        },
      }),
      admin({
        ac,
        roles: authRoles,
        defaultRole: DEFAULT_ROLE,
        adminRoles: [...ADMIN_ROLES],
      }),
      twoFactor({ issuer: "IfOnli" }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __ifonliAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__ifonliAuth ??= createAuth();
  return globalForAuth.__ifonliAuth;
}
