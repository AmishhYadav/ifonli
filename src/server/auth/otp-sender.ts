import "server-only";

import { createHash } from "node:crypto";

import { getDb } from "@/server/db";
import { loadStoreInfo } from "@/server/notify/context";
import { getEmailChannel } from "@/server/notify/email-channel";
import { renderTemplate } from "@/server/notify/templates";
import { siteUrl } from "@/lib/seo";

export type OtpType = "sign-in" | "email-verification" | "forget-password" | "change-email";

export interface SendOtpParams {
  email: string;
  otp: string;
  type: OtpType;
}

/** Must match `emailOTP.expiresIn` in `auth.ts` (600 seconds). */
const OTP_VALID_MINUTES = 10;

/**
 * Delivers a one-time login code through the e-mail channel, DIRECTLY (not via the outbox): the person is
 * waiting on it, so it is sent while the request is open and a failure is surfaced to the caller (Better
 * Auth then fails the request) instead of being retried minutes later with a dead code.
 *
 * Without `RESEND_API_KEY` outside production the mail is written to `.dev-mail/` (see `dev-mail.ts`) and
 * the code is also logged to the server console so local development and tests need no mail client. In
 * production a missing key throws a config error, never a silent drop and never a logged live code.
 */
export async function sendOtp({ email, otp, type }: SendOtpParams): Promise<void> {
  const channel = getEmailChannel();
  const store = await loadStoreInfo(getDb());
  const rendered = await renderTemplate(
    "login_otp",
    { otp, type, expiresMinutes: OTP_VALID_MINUTES },
    { store, siteUrl: siteUrl(), vibe: null },
  );
  const result = await channel.send({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    // One key per code: a retried request with the same code cannot deliver it twice.
    idempotencyKey: `otp-${createHash("sha256").update(`${type}:${otp}:${email.toLowerCase()}`).digest("hex").slice(0, 40)}`,
  });
  if (!result.ok) throw new Error(`Could not send the sign-in code (${result.error})`);
  if (channel.name === "dev-mail") console.info(`[auth:dev] OTP for ${email} (${type}): ${otp}`);
}
