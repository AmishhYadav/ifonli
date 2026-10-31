"use server";

import { APIError } from "better-auth/api";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { completeCustomerSignIn } from "@/server/services/sign-in";

import { getRequestIp, readCartToken, writeCartToken } from "../cart/request";
import { ACCOUNT_HINT_COOKIE, ACCOUNT_HINT_MAX_AGE_SECONDS } from "./hint";
import { loginEmailSchema, safeNextPath, verifyCodeSchema } from "./schema";

export type AuthErrorCode =
  | "invalid_input"
  | "wrong_code"
  | "expired"
  | "too_many_attempts"
  | "rate_limited"
  | "admin_account"
  | "send_failed"
  | "server_error";

export type AuthResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: AuthErrorCode; error: string; retryAfterSeconds?: number };

/** The Resend cooldown the form shows; the per-email limit below is what actually caps sending. */
const RESEND_COOLDOWN_SECONDS = 30;

const SEND_PER_EMAIL = { limit: 5, windowSeconds: 600 };
const SEND_PER_IP = { limit: 20, windowSeconds: 600 };
const VERIFY_PER_EMAIL = { limit: 10, windowSeconds: 600 };
const VERIFY_PER_IP = { limit: 30, windowSeconds: 600 };

function fail(code: AuthErrorCode, error: string, retryAfterSeconds?: number): AuthResult<never> {
  return { ok: false, code, error, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
}

function tooMany(retryAfterSeconds: number): AuthResult<never> {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return fail(
    "rate_limited",
    `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    retryAfterSeconds,
  );
}

function errorCode(error: APIError): string {
  const body = error.body as { code?: unknown } | undefined;
  return typeof body?.code === "string" ? body.code : "";
}

/** Step 1: e-mail a six-digit code. Creates nothing yet: the account is created when the code is used. */
export async function sendLoginCode(
  input: unknown,
): Promise<AuthResult<{ cooldownSeconds: number }>> {
  const parsed = loginEmailSchema.safeParse(input);
  if (!parsed.success) {
    return fail("invalid_input", parsed.error.issues[0]?.message ?? "Enter a valid email address.");
  }
  const { email } = parsed.data;
  try {
    const db = getDb();
    const ip = await getRequestIp();
    const decisions = await Promise.all([
      consumeRateLimit(db, `login-send:ip:${ip}`, SEND_PER_IP),
      consumeRateLimit(db, `login-send:email:${email}`, SEND_PER_EMAIL),
    ]);
    const blocked = decisions.find((d) => !d.allowed);
    if (blocked) return tooMany(blocked.retryAfterSeconds);

    await getAuth().api.sendVerificationOTP({
      body: { email, type: "sign-in" },
      headers: await headers(),
    });
    return { ok: true, data: { cooldownSeconds: RESEND_COOLDOWN_SECONDS } };
  } catch (error) {
    if (error instanceof APIError && error.status === "FORBIDDEN") {
      return fail("admin_account", "Admin accounts sign in at /admin/login.");
    }
    console.error("sendLoginCode failed", error instanceof Error ? error.message : "unknown");
    return fail("send_failed", "We couldn't send the code. Please try again in a moment.");
  }
}

/**
 * Step 2: check the code. On success the session cookie is set, then (once, server side) the guest
 * cart is merged into the customer's cart and past guest orders with this e-mail are attached. A
 * failure of that follow-up never undoes the sign-in: the customer is signed in either way.
 */
export async function verifyLoginCode(
  input: unknown,
): Promise<AuthResult<{ next: string; attachedOrders: number }>> {
  const parsed = verifyCodeSchema.safeParse(input);
  if (!parsed.success) {
    return fail("invalid_input", parsed.error.issues[0]?.message ?? "Enter the 6-digit code.");
  }
  const { email, code } = parsed.data;
  const next = safeNextPath((input as { next?: unknown } | null)?.next);

  try {
    const db = getDb();
    const ip = await getRequestIp();
    const decisions = await Promise.all([
      consumeRateLimit(db, `login-verify:ip:${ip}`, VERIFY_PER_IP),
      consumeRateLimit(db, `login-verify:email:${email}`, VERIFY_PER_EMAIL),
    ]);
    const blocked = decisions.find((d) => !d.allowed);
    if (blocked) return tooMany(blocked.retryAfterSeconds);

    const result = await getAuth().api.signInEmailOTP({
      body: { email, otp: code },
      headers: await headers(),
    });

    let attachedOrders = 0;
    try {
      const guestCartToken = await readCartToken();
      const outcome = await completeCustomerSignIn(db, {
        userId: result.user.id,
        email: result.user.email,
        guestCartToken,
      });
      if (outcome.cartToken && outcome.cartToken !== guestCartToken) {
        await writeCartToken(outcome.cartToken);
      }
      attachedOrders = outcome.attachedOrders;
    } catch (error) {
      console.error("sign-in follow-up failed", error instanceof Error ? error.message : "unknown");
    }

    (await cookies()).set(ACCOUNT_HINT_COOKIE, "1", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ACCOUNT_HINT_MAX_AGE_SECONDS,
    });
    return { ok: true, data: { next, attachedOrders } };
  } catch (error) {
    if (error instanceof APIError) {
      const code = errorCode(error);
      if (code === "OTP_EXPIRED") {
        return fail("expired", "That code has expired. Ask for a new one.");
      }
      if (code === "TOO_MANY_ATTEMPTS") {
        return fail(
          "too_many_attempts",
          "Too many wrong attempts for that code. Ask for a new one.",
        );
      }
      if (error.status === "FORBIDDEN") {
        return fail("admin_account", "Admin accounts sign in at /admin/login.");
      }
      return fail("wrong_code", "That code isn't right. Check it and try again.");
    }
    console.error("verifyLoginCode failed", error instanceof Error ? error.message : "unknown");
    return fail("server_error", "Something went wrong on our side. Please try again.");
  }
}

/** Ends the session on the server and forgets the sign-in hint. The device wishlist stays on the device. */
export async function signOutCustomer(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch (error) {
    console.error("signOutCustomer failed", error instanceof Error ? error.message : "unknown");
  }
  (await cookies()).delete(ACCOUNT_HINT_COOKIE);
  redirect("/");
}
