import "@/lib/zod-csp";
import { z } from "zod";

/**
 * Checkout form schemas (plan 7.4): shared by the client form (react-hook-form resolver) and the
 * server actions / services, so both enforce the same rules with the same human messages (FR-08).
 * Pure: no server-only imports.
 */

export const PAYMENT_METHODS = ["razorpay", "cod"] as const;
export type CheckoutPaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Indian pincodes are 6 digits and never start with 0. */
export const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

/**
 * Normalises an Indian mobile number to `+91XXXXXXXXXX`. Accepts spaces / dashes / brackets and the
 * usual prefixes (`+91`, `91`, `0`). Returns null when it is not a valid mobile number
 * (10 digits starting 6-9).
 */
export function normalizeIndianPhone(raw: string): string | null {
  let digits = raw.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export const emailSchema = z
  .string({ error: "Enter your email address" })
  .trim()
  .min(1, "Enter your email address")
  .max(254, "That email address is too long")
  .toLowerCase()
  .pipe(z.email("Enter a valid email address, like name@example.com"));

export const phoneSchema = z
  .string({ error: "Enter your mobile number" })
  .trim()
  .min(1, "Enter your mobile number")
  .transform((value, ctx) => {
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

export const pincodeSchema = z
  .string({ error: "Enter your 6-digit pincode" })
  .trim()
  .regex(PINCODE_PATTERN, "Enter a valid 6-digit pincode");

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => (v ? v : undefined));

export const addressSchema = z.object({
  name: z
    .string({ error: "Enter the recipient's full name" })
    .trim()
    .min(2, "Enter the recipient's full name")
    .max(100, "That name is too long"),
  line1: z
    .string({ error: "Enter your house or flat number and street" })
    .trim()
    .min(3, "Enter your house or flat number and street")
    .max(200, "That address line is too long"),
  line2: optionalText(200, "That address line is too long"),
  landmark: optionalText(120, "That landmark is too long"),
  city: z
    .string({ error: "Enter your city or town" })
    .trim()
    .min(2, "Enter your city or town")
    .max(80, "That city name is too long"),
  state: z
    .string({ error: "Choose your state" })
    .trim()
    .min(2, "Choose your state")
    .max(60, "That state name is too long"),
  pincode: pincodeSchema,
});

export const paymentMethodSchema = z.enum(PAYMENT_METHODS, {
  error: "Choose how you'd like to pay",
});

/** The unticked-by-default policy acknowledgement must be explicitly true. */
export const policyAckSchema = z.literal(true, {
  error: "Please tick the box to confirm you've read our returns, terms and privacy policies",
});

export const checkoutFormSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  shippingAddress: addressSchema,
  paymentMethod: paymentMethodSchema,
  policyAck: policyAckSchema,
});

/** Raw form values (what the inputs hold). */
export type CheckoutFormInput = z.input<typeof checkoutFormSchema>;
/** Validated, normalised values (lower-cased email, `+91` phone, trimmed text). */
export type CheckoutFormValues = z.output<typeof checkoutFormSchema>;
export type AddressValues = z.output<typeof addressSchema>;

/** What `placeOrder` accepts: the form plus the per-attempt idempotency key and the active vibe. */
export const placeOrderSchema = checkoutFormSchema.extend({
  /** Random per checkout attempt (generate once when the checkout form mounts). */
  idempotencyKey: z.uuid("Something went wrong. Please refresh the page and try again."),
  /** Vibe slug active when the order is placed; themes the order emails. */
  vibe: z
    .string()
    .trim()
    .max(40)
    .regex(/^[a-z0-9-]+$/)
    .nullish(),
});
export type PlaceOrderInput = z.input<typeof placeOrderSchema>;

/** Live quote request: everything optional so it can run as the customer fills the form. */
export const checkoutQuoteSchema = z.object({
  // A half-typed value is treated as "not entered yet" instead of failing the whole quote.
  pincode: pincodeSchema.optional().catch(undefined),
  paymentMethod: paymentMethodSchema.optional().catch(undefined),
  email: emailSchema.optional().catch(undefined),
});
export type CheckoutQuoteInput = z.input<typeof checkoutQuoteSchema>;

export const pincodeLookupSchema = z.object({ pincode: pincodeSchema });
