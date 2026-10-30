import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP, twoFactor } from "better-auth/plugins";

import { getServerEnv } from "@/lib/env";
import { getDb } from "@/server/db";
import * as schema from "@/server/db/schema";

import { sendOtp } from "./otp-sender";
import { ADMIN_ROLES, DEFAULT_ROLE, ac, authRoles } from "./permissions";

/**
 * Better Auth instance (server only). No route handlers live here: Phase 3 mounts
 * `toNextJsHandler(getAuth())` under `src/app/api/auth/[...all]`.
 *
 * - `emailOTP`: passwordless login for customers and admins. Delivery goes through `sendOtp`
 *   (console in dev, Resend in Phase 5).
 * - `admin`: roles `owner | admin | fulfilment | customer` (default `customer`), with the access
 *   control built from `permissions.ts`.
 * - `twoFactor`: TOTP for admin roles.
 *   NOTE: Better Auth's two-factor after-hook only intercepts credential sign-ins
 *   (`/sign-in/email|username|phone-number`), NOT `/sign-in/email-otp`. Enforcing TOTP for admins
 *   on the OTP flow therefore has to be done by the Phase 3 admin gate (see docs/DATA-MODEL.md).
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
    advanced: { cookiePrefix: "ifonli" },
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
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __ifonliAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__ifonliAuth ??= createAuth();
  return globalForAuth.__ifonliAuth;
}
