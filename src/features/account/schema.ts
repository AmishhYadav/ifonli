import { z } from "zod";

import {
  addressSchema,
  emailSchema,
  normalizeIndianPhone,
  phoneSchema,
} from "@/features/checkout/schema";

/**
 * Account form schemas (plan 7.12): shared by the client forms and the Server Actions so both
 * enforce the same rules and messages. Address and phone rules are the checkout's own (one source of
 * truth for what a deliverable address looks like). Pure: no server-only imports.
 */

/** A customer keeps at most this many saved addresses. */
export const MAX_ADDRESSES = 10;

export const LOGIN_PATH = "/account/login";
export const DEFAULT_AFTER_LOGIN = "/account";

/**
 * Where to send the customer after sign-in, from the `?next=` parameter. Only a same-origin relative
 * path is accepted (starts with a single `/`; no scheme, no `//host`, no backslashes, no control
 * characters), so the login page can never be used as an open redirect. The login page itself is
 * refused too (it would loop). Anything else falls back to `/account`.
 */
export function safeNextPath(raw: unknown, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, "http://ifonli.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://ifonli.invalid") return fallback;
  if (url.pathname === LOGIN_PATH || url.pathname.startsWith(`${LOGIN_PATH}/`)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

export const loginEmailSchema = z.object({ email: emailSchema });

/** The six digits from the e-mail; spaces and dashes people paste along with them are ignored. */
export const otpCodeSchema = z
  .string({ error: "Enter the 6-digit code from your email" })
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your email"));

export const verifyCodeSchema = z.object({ email: emailSchema, code: otpCodeSchema });

/** Phone on the profile is optional: blank clears it, anything else must be an Indian mobile number. */
const optionalPhone = z
  .string()
  .trim()
  .max(32, "Enter a 10-digit Indian mobile number, like 98765 43210")
  .transform((value, ctx): string | null => {
    if (value === "") return null;
    const phone = normalizeIndianPhone(value);
    if (phone === null) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a 10-digit Indian mobile number, like 98765 43210",
      });
      return z.NEVER;
    }
    return phone;
  });

export const profileSchema = z.object({
  name: z
    .string({ error: "Enter your name" })
    .trim()
    .min(2, "Enter your name")
    .max(100, "That name is too long"),
  phone: optionalPhone,
  /** Never pre-ticked (plan: marketing consent is opt-in). */
  marketingOptIn: z.boolean(),
});
export type ProfileInput = z.input<typeof profileSchema>;
export type ProfileValues = z.output<typeof profileSchema>;

export const accountAddressSchema = addressSchema.extend({
  phone: phoneSchema,
  isDefault: z.boolean().optional(),
});
export type AccountAddressInput = z.input<typeof accountAddressSchema>;
export type AccountAddressValues = z.output<typeof accountAddressSchema>;

/** Deleting an account is irreversible, so it needs the word typed out. */
export const DELETE_CONFIRMATION = "DELETE";
export const deleteAccountSchema = z.object({
  confirmation: z
    .string()
    .trim()
    .refine(
      (v) => v.toUpperCase() === DELETE_CONFIRMATION,
      `Type ${DELETE_CONFIRMATION} to confirm`,
    ),
});

/** The orders list shows this many per page. */
export const ORDERS_PAGE_SIZE = 10;

/** `?page=` -> a positive integer (1 for anything unusable). */
export function parsePageParam(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}
