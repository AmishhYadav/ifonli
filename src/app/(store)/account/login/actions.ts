"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { safeNextPath } from "@/features/account/redirect";
import { setAccountHint } from "@/features/account/session-hint";
import { clearCartToken, getRequestIp, keyDigest, readCartToken, writeCartToken } from "@/features/cart/request";
import { emailSchema } from "@/features/checkout/schema";
import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db";
import { ensureProfile } from "@/server/services/account";
import { mergeCarts } from "@/server/services/cart";
import { consumeRateLimit } from "@/server/services/rate-limit";

import type { LoginState } from "./types";

/** Requests for a code, per window: a person can ask a few times; a script cannot flood an inbox. */
const SEND_LIMITS = {
  ip: { limit: 10, windowSeconds: 900 },
  email: { limit: 5, windowSeconds: 900 },
} as const;
/** Attempts to enter a code (Better Auth also locks a code after 5 wrong tries). */
const VERIFY_LIMITS = {
  ip: { limit: 30, windowSeconds: 900 },
  email: { limit: 10, windowSeconds: 900 },
} as const;

const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your email");

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

function tooMany(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/**
 * Plan 7.2: "On login, the guest cart merges". The new session is not on this request yet, so the user id
 * comes from the sign-in result. Never blocks the login: a failed merge leaves both carts as they were.
 */
async function mergeGuestCartOnLogin(db: ReturnType<typeof getDb>, userId: string): Promise<void> {
  try {
    const token = await readCartToken();
    const merged = await mergeCarts(db, token, userId);
    if (merged.token && merged.token !== token) await writeCartToken(merged.token);
    // The cookie cart is another account's and this user has none: drop the cookie, do not reuse it.
    else if (!merged.token && token) await clearCartToken();
  } catch (e) {
    unstable_rethrow(e);
    console.error("cart merge on login failed", e instanceof Error ? e.message : "unknown");
  }
}

/**
 * One action for the whole OTP login (plan 1, decision 4), switched by the hidden `intent`:
 *  - `send` (also "resend"): rate limit by IP and e-mail, then e-mail a 6-digit code;
 *  - `verify`: check the code, sign in (Better Auth creates the customer on first sign-in; the role is
 *    always `customer`, admin addresses are refused by the guards in `auth.ts`), then go to `next`;
 *  - `change`: back to the e-mail step.
 * Whether an address is an admin account is never revealed: every valid address gets the same
 * "code sent" screen.
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const intent = text(formData.get("intent"));
  const next = safeNextPath(text(formData.get("next")));
  const typed = text(formData.get("email")).trim().slice(0, 254);

  if (intent === "change") return { step: "email", email: typed, next };

  const email = emailSchema.safeParse(typed);
  if (!email.success) {
    return {
      step: "email",
      email: typed,
      next,
      error: email.error.issues[0]?.message ?? "Enter a valid email address",
      errorField: "email",
    };
  }
  const address = email.data;

  try {
    const db = getDb();
    const ip = await getRequestIp();

    if (intent === "verify") {
      const otp = otpSchema.safeParse(text(formData.get("otp")));
      if (!otp.success) {
        return { step: "code", email: address, next, error: otp.error.issues[0]?.message, errorField: "otp" };
      }
      const decisions = await Promise.all([
        consumeRateLimit(db, `otp-verify:ip:${ip}`, VERIFY_LIMITS.ip),
        consumeRateLimit(db, `otp-verify:email:${keyDigest(address)}`, VERIFY_LIMITS.email),
      ]);
      const blocked = decisions.find((d) => !d.allowed);
      if (blocked) {
        return { step: "code", email: address, next, error: tooMany(blocked.retryAfterSeconds) };
      }
      try {
        const res = await getAuth().api.signInEmailOTP({
          body: { email: address, otp: otp.data },
          headers: await headers(),
        });
        await ensureProfile(db, res.user.id);
        await setAccountHint();
        await mergeGuestCartOnLogin(db, res.user.id);
      } catch (e) {
        unstable_rethrow(e);
        if (e instanceof APIError) {
          return {
            step: "code",
            email: address,
            next,
            error: "That code isn't right, or it has expired. Check the code or ask for a new one.",
            errorField: "otp",
          };
        }
        throw e;
      }
      redirect(next);
    }

    // intent === "send"
    const decisions = await Promise.all([
      consumeRateLimit(db, `otp-send:ip:${ip}`, SEND_LIMITS.ip),
      consumeRateLimit(db, `otp-send:email:${keyDigest(address)}`, SEND_LIMITS.email),
    ]);
    const blocked = decisions.find((d) => !d.allowed);
    if (blocked) {
      return { step: "email", email: address, next, error: tooMany(blocked.retryAfterSeconds), errorField: "email" };
    }
    try {
      await getAuth().api.sendVerificationOTP({
        body: { email: address, type: "sign-in" },
        headers: await headers(),
      });
    } catch (e) {
      unstable_rethrow(e);
      // An admin address is refused by the guard: same screen, no code, nothing revealed.
      if (!(e instanceof APIError && e.statusCode === 403)) {
        console.error("login code could not be sent", e instanceof Error ? e.message : "unknown");
        return {
          step: "email",
          email: address,
          next,
          error: "We couldn't send the code just now. Please try again in a moment.",
          errorField: "email",
        };
      }
    }
    return {
      step: "code",
      email: address,
      next,
      info: `We sent a 6-digit code to ${address}. It works for 10 minutes.`,
    };
  } catch (e) {
    unstable_rethrow(e);
    console.error("loginAction failed", e instanceof Error ? e.message : "unknown");
    return {
      step: intent === "verify" ? "code" : "email",
      email: address,
      next,
      error: "Something went wrong on our side. Please try again.",
    };
  }
}
