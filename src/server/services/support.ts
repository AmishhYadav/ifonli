import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { emailSchema, normalizeIndianPhone } from "@/features/checkout/schema";
import { contactMessages } from "@/server/db/schema";
import {
  enqueueAdminAlert,
  enqueueCustomerNotification,
  type NotificationTemplate,
} from "@/server/notify/outbox";

import { consumeRateLimit } from "./rate-limit";
import type { DbClient } from "./queries/shared";

/**
 * Help-page contact form (plan section 10): validates, rate limits by IP and by e-mail, stores a
 * `contact_messages` row and writes the acknowledgement (`contact_ack`, to the customer) and the team alert
 * (`new_contact`, to the admin recipients) to the outbox in the same transaction.
 */

export const CONTACT_FIELDS = ["name", "email", "phone", "orderRef", "message"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

export const CONTACT_MESSAGE_MIN = 10;
export const CONTACT_MESSAGE_MAX = 2000;

/** Optional field: blank means "not given". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

export const contactSchema = z.object({
  name: z
    .string({ error: "Enter your name" })
    .trim()
    .min(2, "Enter your name")
    .max(120, "That name is too long"),
  email: emailSchema,
  phone: optional(
    z
      .string()
      .trim()
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
      }),
  ),
  orderRef: optional(
    z
      .string()
      .trim()
      .max(40, "That order reference is too long")
      .transform((v) => v.toUpperCase()),
  ),
  message: z
    .string({ error: "Tell us how we can help" })
    .trim()
    .min(CONTACT_MESSAGE_MIN, `Write at least ${CONTACT_MESSAGE_MIN} characters so we can help`)
    .max(CONTACT_MESSAGE_MAX, `Keep it under ${CONTACT_MESSAGE_MAX} characters`),
});
export type ContactInput = z.infer<typeof contactSchema>;

export type ContactResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "invalid"; fieldErrors: Partial<Record<ContactField, string>> }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

export const CONTACT_LIMITS = {
  ip: { limit: 5, windowSeconds: 900 },
  email: { limit: 3, windowSeconds: 3600 },
} as const;

/** The outbox template names for the contact flow (see emails/payloads.ts). */
const asTemplate = (name: "contact_ack" | "new_contact") => name as NotificationTemplate;

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

export async function createContactMessage(
  db: DbClient,
  raw: Record<string, unknown>,
  opts: { ip: string },
): Promise<ContactResult> {
  // Honeypot: real people never see the field. Pretend it worked so bots learn nothing.
  const trap = raw.website;
  if (typeof trap === "string" && trap.trim() !== "") return { ok: true, id: null };

  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<ContactField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && (CONTACT_FIELDS as readonly string[]).includes(field)) {
        fieldErrors[field as ContactField] ??= issue.message;
      }
    }
    return { ok: false, reason: "invalid", fieldErrors };
  }
  const input = parsed.data;

  const decisions = await Promise.all([
    consumeRateLimit(db, `contact:ip:${opts.ip}`, CONTACT_LIMITS.ip),
    consumeRateLimit(db, `contact:email:${digest(input.email)}`, CONTACT_LIMITS.email),
  ]);
  const blocked = decisions.find((d) => !d.allowed);
  if (blocked) return { ok: false, reason: "rate_limited", retryAfterSeconds: blocked.retryAfterSeconds };

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contactMessages)
      .values({
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        orderRef: input.orderRef ?? null,
        message: input.message,
      })
      .returning({ id: contactMessages.id });
    const messageId = (row as { id: string }).id;
    await enqueueCustomerNotification(tx, {
      template: asTemplate("contact_ack"),
      to: input.email,
      payload: { name: input.name, messageId },
    });
    await enqueueAdminAlert(tx, {
      template: asTemplate("new_contact"),
      payload: {
        name: input.name,
        email: input.email,
        orderRef: input.orderRef ?? null,
        message: input.message,
        messageId,
      },
    });
    return messageId;
  });
  return { ok: true, id };
}
