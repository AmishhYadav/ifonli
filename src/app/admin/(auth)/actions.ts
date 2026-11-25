"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { z } from "zod";

import {
  MIN_ADMIN_PASSWORD_LENGTH,
  clearPasswordChangeRequired,
  getPasswordChangeState,
} from "@/server/auth/admin-user";
import {
  consumeAdminLoginAttempt,
  isAdminLoginLocked,
  recordFailedAdminLogin,
} from "@/server/auth/admin-login-guard";
import { authErrorStatus, isAuthApiError } from "@/server/auth/api-error";
import { getAuth } from "@/server/auth/auth";
import {
  BREACHED_PASSWORD_MESSAGE,
  BREACH_CHECK_UNAVAILABLE_MESSAGE,
  checkPasswordBreach,
} from "@/server/auth/password-breach";
import { adminPasswordProblem, describeAdminPasswordProblem } from "@/server/auth/password-policy";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { alertOnNewSignIn } from "@/server/auth/security-alerts";
import { getClientIp, getSession, requireEnrolling } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { writeAudit } from "@/server/services/audit";

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const GENERIC_LOGIN_ERROR = "Invalid email or password.";
const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});
const codeSchema = z.string().trim().min(6).max(32);

async function limited(key: string, limit: number, windowSec: number): Promise<boolean> {
  const ip = (await getClientIp()) ?? "unknown";
  const res = await consumeRateLimit(`${key}:${ip}`, { limit, windowSec });
  return !res.allowed;
}

/**
 * Step 1: email + password. Enrolled admins get a TOTP challenge; others go to enrolment.
 *
 * Limits, in order (every refusal is the same generic `TOO_MANY`, so the response never says which
 * one fired nor whether the account exists):
 *  - 30 attempts per 10 minutes per IP;
 *  - daily budgets of WRONG passwords per e-mail: 10 from one address (that address is then locked
 *    out of the account) and 100 from all addresses together (the account is then locked everywhere).
 *    Once spent, every attempt is refused, even with the right password, until the 24-hour window
 *    ends. They are checked read-only up front and only failures are added, so successful sign-ins
 *    never use them up. The first lock of each kind in a window e-mails the owners and the account
 *    holder (`recordFailedAdminLogin`);
 *  - 8 attempts of any kind per 10 minutes per e-mail.
 * E-mails are keyed by a sha256 digest, never stored raw in `rate_limits`.
 */
export async function signInAction(input: unknown): Promise<Result<{ next: "totp" | "enroll" }>> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_LOGIN_ERROR };
  const { email, password } = parsed.data;
  if (await limited("admin-login", 30, 600)) return { ok: false, error: TOO_MANY };
  const ip = await getClientIp();
  if (await isAdminLoginLocked(email, ip)) return { ok: false, error: TOO_MANY };
  if (!(await consumeAdminLoginAttempt(email))) return { ok: false, error: TOO_MANY };

  try {
    const res = (await getAuth().api.signInEmail({
      body: { email, password },
      headers: await headers(),
    })) as { twoFactorRedirect?: boolean } | null;
    return { ok: true, data: { next: res?.twoFactorRedirect ? "totp" : "enroll" } };
  } catch (error) {
    if (isAuthApiError(error)) {
      await recordFailedAdminLogin(email, ip);
      return { ok: false, error: GENERIC_LOGIN_ERROR };
    }
    throw error;
  }
}

/** Step 2: authenticator code (or a backup code) completes the sign-in. */
export async function verifyTotpAction(input: unknown): Promise<Result> {
  const parsed = z.object({ code: codeSchema, backup: z.boolean().optional() }).safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  if (await limited("admin-2fa", 10, 600)) return { ok: false, error: TOO_MANY };
  const auth = getAuth();
  try {
    const res = parsed.data.backup
      ? await auth.api.verifyBackupCode({
          body: { code: parsed.data.code },
          headers: await headers(),
        })
      : await auth.api.verifyTOTP({ body: { code: parsed.data.code }, headers: await headers() });
    const ip = await getClientIp();
    // Judge "new address" BEFORE this sign-in's own audit row exists. Never blocks or fails the sign-in.
    await alertOnNewSignIn(getDb(), {
      userId: res.user.id,
      email: res.user.email,
      role: (res.user as { role?: string }).role ?? "admin",
      ip,
      userAgent: (await headers()).get("user-agent"),
    });
    await writeAudit(getDb(), {
      actorId: res.user.id,
      action: "admin.login",
      entity: "user",
      entityId: res.user.id,
      diff: { method: parsed.data.backup ? "backup_code" : "totp" },
      ip,
    });
    return { ok: true, data: undefined };
  } catch (error) {
    if (isAuthApiError(error)) {
      return { ok: false, error: "That code is not valid or has expired. Try again." };
    }
    throw error;
  }
}

export interface EnrollmentStart {
  qrDataUrl: string;
  /** Base32 secret for manual entry. */
  secret: string;
  backupCodes: string[];
}

/**
 * Enrolment step 1: re-enter the password; returns the QR code, manual key and backup codes.
 * When the password is a temporary one (new account, owner reset), a new password is required here
 * and replaces it (other sessions are signed out), so whoever was handed the temporary password
 * cannot keep the account by enrolling first.
 */
export async function startEnrollmentAction(input: unknown): Promise<Result<EnrollmentStart>> {
  const admin = await requireEnrolling();
  const parsed = z
    .object({
      password: z.string().min(1).max(200),
      newPassword: z.string().max(128).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter your password." };
  if (await limited("admin-enroll", 8, 600)) return { ok: false, error: TOO_MANY };
  const mustChange = (await getPasswordChangeState(getDb(), admin.user.id)).state === "required";
  const { password, newPassword } = parsed.data;
  if (mustChange) {
    if (!newPassword || newPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
      return { ok: false, error: `Choose a new password of at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.` };
    }
    if (newPassword === password) {
      return { ok: false, error: "The new password must be different from the temporary one." };
    }
    // Checked before any state changes (turning two-factor on comes next), so a refusal leaves nothing half done.
    const problem = adminPasswordProblem(newPassword, admin.user.email);
    if (problem) return { ok: false, error: describeAdminPasswordProblem(problem) };
    const breach = await checkPasswordBreach(newPassword);
    if (breach === "breached") return { ok: false, error: BREACHED_PASSWORD_MESSAGE };
    if (breach === "unavailable") return { ok: false, error: BREACH_CHECK_UNAVAILABLE_MESSAGE };
  }
  try {
    const auth = getAuth();
    const res = await auth.api.enableTwoFactor({
      body: { password, issuer: "IfOnli", method: "totp" },
      headers: await headers(),
    });
    if (res.method !== "totp") return { ok: false, error: "Could not start two-factor setup." };
    if (mustChange && newPassword) {
      try {
        await auth.api.changePassword({
          body: { currentPassword: password, newPassword, revokeOtherSessions: true },
          headers: await headers(),
        });
      } catch (error) {
        // The `haveIBeenPwned` plugin (auth.ts) checks again inside changePassword; it is the safety
        // net for the pre-check above (a breach list that changed in between, or a blip).
        if (isAuthApiError(error)) {
          const code = (error as { body?: { code?: string } }).body?.code;
          if (code === "PASSWORD_COMPROMISED") return { ok: false, error: BREACHED_PASSWORD_MESSAGE };
          if (authErrorStatus(error) === 500) return { ok: false, error: BREACH_CHECK_UNAVAILABLE_MESSAGE };
        }
        throw error;
      }
      await clearPasswordChangeRequired(getDb(), admin.user.id);
      await writeAudit(getDb(), {
        actorId: admin.user.id,
        action: "admin.password_changed",
        entity: "user",
        entityId: admin.user.id,
        diff: { reason: "temporary_password_replaced" },
        ip: await getClientIp(),
      });
    }
    const secret = new URL(res.totpURI).searchParams.get("secret") ?? "";
    return {
      ok: true,
      data: {
        qrDataUrl: await QRCode.toDataURL(res.totpURI, { margin: 1, width: 224 }),
        secret,
        backupCodes: res.backupCodes ?? [],
      },
    };
  } catch (error) {
    if (isAuthApiError(error)) return { ok: false, error: "Incorrect password." };
    throw error;
  }
}

/** Enrolment step 2: a valid code from the app turns two-factor on for the account. */
export async function finishEnrollmentAction(input: unknown): Promise<Result> {
  const admin = await requireEnrolling();
  const parsed = z.object({ code: codeSchema }).safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  if (await limited("admin-enroll-verify", 10, 600)) return { ok: false, error: TOO_MANY };
  if ((await getPasswordChangeState(getDb(), admin.user.id)).state === "required") {
    return { ok: false, error: "Choose your new password first." };
  }
  try {
    await getAuth().api.verifyTOTP({ body: { code: parsed.data.code }, headers: await headers() });
    await writeAudit(getDb(), {
      actorId: admin.user.id,
      action: "admin.2fa_enrolled",
      entity: "user",
      entityId: admin.user.id,
      ip: await getClientIp(),
    });
    return { ok: true, data: undefined };
  } catch (error) {
    if (isAuthApiError(error))
      return {
        ok: false,
        error: "That code is not valid. Check the time on your phone and try again.",
      };
    throw error;
  }
}

export async function signOutAction(): Promise<void> {
  const session = await getSession();
  if (session) {
    await writeAudit(getDb(), {
      actorId: session.user.id,
      action: "admin.logout",
      entity: "user",
      entityId: session.user.id,
      ip: await getClientIp(),
    });
  }
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/admin/login");
}
