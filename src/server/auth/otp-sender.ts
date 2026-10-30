import "server-only";

export type OtpType = "sign-in" | "email-verification" | "forget-password" | "change-email";

export interface SendOtpParams {
  email: string;
  otp: string;
  type: OtpType;
}

/**
 * Delivers a one-time login code.
 *
 * PHASE 5 HOOK: replace the body with the Resend + React Email sender (`src/server/notify/email.ts`).
 * Until then, outside production the OTP is logged to the server console so local development and
 * tests work without an email provider. In production this throws rather than silently dropping
 * the code (or, worse, logging a live secret).
 */
export async function sendOtp({ email, otp, type }: SendOtpParams): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("OTP email delivery is not configured yet (Phase 5: Resend sender).");
  }
  console.info(`[auth:dev] OTP for ${email} (${type}): ${otp}`);
}
