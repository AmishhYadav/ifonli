import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, emailOTP, twoFactor } from "better-auth/plugins";

import { getServerEnv } from "@/lib/env";
import { getDb } from "@/server/db";
import * as schema from "@/server/db/schema";

import { sendOtp } from "./otp-sender";
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
 *   `auth.api.*` calls from our Server Actions), so it is configured for the handler with the
 *   default in-memory store, and the admin login actions use the Postgres limiter in `rate-limit.ts`.
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
