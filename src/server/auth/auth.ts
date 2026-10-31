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
import { consumeRateLimit } from "./rate-limit";
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

const OTP_EMAIL_LIMITED_PATHS = new Set(["/email-otp/send-verification-otp", "/sign-in/email-otp"]);
/** Codes per email address per 10 minutes (resends included). */
const OTP_EMAIL_LIMIT = { limit: 5, windowSec: 600 } as const;

/**
 * D-AUTH-1 guards, run before the endpoint:
 *  - credential sign-in (`/sign-in/email`) is refused unless the account holds an admin role
 *    (customers are passwordless); the error is the same as a wrong password so nobody can probe
 *    which emails exist or what role they have;
 *  - every emailOTP endpoint is refused for admin roles (Better Auth's two-factor hook does not
 *    fire on `/sign-in/email-otp`, so an OTP sign-in would skip TOTP);
 *  - the admin plugin's own endpoints (`/admin/*`) need a TOTP-enrolled session.
 */
const guards = createAuthMiddleware(async (ctx) => {
  const path = ctx.path;
  const body = ctx.body as { email?: unknown } | undefined;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;

  if (path === "/sign-in/email") {
    const found = email ? await ctx.context.internalAdapter.findUserByEmail(email) : null;
    if (found && !isAdminRole((found.user as { role?: string }).role)) {
      throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
    }
    return;
  }

  if (isEmailOtpPath(path)) {
    // Per-address cap on top of the per-IP rule: stops one inbox being mail-bombed from many IPs.
    if (email && OTP_EMAIL_LIMITED_PATHS.has(path)) {
      const digest = createHash("sha256").update(email).digest("hex").slice(0, 24);
      const res = await consumeRateLimit(`otp-email:${digest}`, OTP_EMAIL_LIMIT);
      if (!res.allowed) {
        throw new APIError("TOO_MANY_REQUESTS", {
          message: "Too many sign-in codes requested. Please wait a few minutes and try again.",
        });
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
 * - Rate limit: Better Auth's limiter only sees requests through the HTTP handler (not
 *   `auth.api.*` calls from our Server Actions). Its counters live in Postgres (`rate_limits`, via
 *   `customStorage`) because the default in-memory store is per serverless instance and so useless on
 *   Vercel. The admin login Server Actions and the per-email OTP cap use the same Postgres limiter
 *   (`rate-limit.ts`).
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
      customRules: {
        "/sign-in/email": { window: 300, max: 8 },
        "/two-factor/verify-totp": { window: 300, max: 10 },
        "/two-factor/verify-backup-code": { window: 300, max: 10 },
      },
    },
    hooks: { before: guards },
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
