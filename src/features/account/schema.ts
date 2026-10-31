import { z } from "zod";

import { addressSchema, phoneSchema } from "@/features/checkout/schema";

/**
 * Account form schemas. Pure (no server imports): the client forms and the services share them, and
 * the address rules are the checkout's own (`addressSchema`), so a saved address always works at
 * checkout.
 */

export const MAX_SAVED_ADDRESSES = 10;

/** Blank means "not given". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

export const profileSchema = z.object({
  name: z
    .string({ error: "Enter your name" })
    .trim()
    .min(2, "Enter your name")
    .max(100, "That name is too long"),
  phone: optional(phoneSchema),
  /** Never pre-ticked (dark-patterns rule): the form starts from the stored value, default false. */
  marketingOptIn: z.boolean().default(false),
});
export type ProfileInput = z.input<typeof profileSchema>;
export type ProfileValues = z.output<typeof profileSchema>;

export const accountAddressSchema = addressSchema.extend({
  phone: phoneSchema,
  isDefault: z.boolean().default(false),
});
export type AccountAddressInput = z.input<typeof accountAddressSchema>;
export type AccountAddressValues = z.output<typeof accountAddressSchema>;

/** Field name -> message map for forms, from a Zod error (first message per field). */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/** An address as the account and checkout screens use it. */
export interface SavedAddress {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}
