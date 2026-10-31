import { z } from "zod";

import type { EmailContext } from "./types";

/**
 * Outbox payload shapes, one per template. They stay thin on purpose: order e-mails read the order
 * (items, amounts, address) at send time, so a payload carries only identifiers and the few facts that
 * belong to the event. Unknown keys are ignored (older rows keep working).
 *
 * `accessToken` is optional and never written by the current flows (the raw token is shown once, only
 * its hash is stored). When it is absent the CTA points to /track.
 */
const ref = z.string().min(1).max(40);
const paise = z.number().int().nonnegative();
const orderBits = {
  ref,
  orderId: z.uuid().optional(),
  accessToken: z.string().min(8).max(128).optional(),
  /** Set when an admin re-sent the e-mail. */
  resent: z.boolean().optional(),
};
const text = (max: number) => z.string().max(max);

/** Courier tracking links are admin-entered: http(s) only, never `javascript:`. */
const httpUrl = z
  .url()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), "must be http(s)");

export const payloadSchemas = {
  order_confirmed: z.object({
    ...orderBits,
    totalPaise: paise,
    paymentMethod: z.enum(["razorpay", "cod"]),
    /** Payment arrived after the reservation expired but stock was still available. */
    late: z.boolean().optional(),
  }),
  cod_placed: z.object({ ...orderBits, totalPaise: paise }),
  payment_failed: z.object({ ...orderBits }),
  order_shipped: z.object({
    ...orderBits,
    courier: text(80).nullable(),
    awb: text(80).nullable(),
    trackingUrl: httpUrl.nullable(),
  }),
  order_delivered: z.object({ ...orderBits }),
  order_cancelled: z.object({ ...orderBits }),
  refund_initiated: z.object({ ref, orderId: z.uuid().optional(), refundId: z.string().min(1), amountPaise: paise }),
  refund_processed: z.object({ ref, orderId: z.uuid().optional(), refundId: z.string().min(1), amountPaise: paise }),
  payment_late_refund: z.object({ ref, orderId: z.uuid().optional(), refundId: z.string().min(1), amountPaise: paise }),
  support_case_update: z.object({
    ref,
    caseId: z.string().min(1),
    status: z.enum(["open", "in_progress", "resolved", "rejected"]),
    resolution: z.enum(["refund", "replacement", "rejected"]).nullable().optional(),
    /** Customer-visible note from the team. */
    note: text(1000).nullable().optional(),
  }),
  contact_ack: z.object({ name: text(120), messageId: z.string().optional() }),
  /** A team member's reply to a contact-form message (admin Support inbox). */
  contact_reply: z.object({
    name: text(120),
    /** The reply, plain text; line breaks are kept. */
    message: z.string().min(1).max(4000),
    /** What the customer wrote, quoted under the reply. */
    original: text(4000).nullable().optional(),
    messageId: z.string().optional(),
  }),
  login_otp: z.object({
    otp: z.string().regex(/^\d{4,10}$/),
    type: z.enum(["sign-in", "email-verification", "forget-password", "change-email"]),
    expiresMinutes: z.number().int().positive().max(60),
  }),

  // ------------------------------------------------------------------ admin alerts
  new_order: z.object({
    ref,
    orderId: z.uuid().optional(),
    totalPaise: paise,
    paymentMethod: z.enum(["razorpay", "cod"]),
    late: z.boolean().optional(),
  }),
  low_stock_digest: z.object({
    /** Total low or out-of-stock variants (rows may be capped). */
    total: z.number().int().nonnegative(),
    rows: z
      .array(
        z.object({
          sku: text(80),
          productName: text(200),
          variantTitle: text(200),
          available: z.number().int(),
          threshold: z.number().int(),
        }),
      )
      .max(200),
  }),
  payment_anomaly: z.object({
    kind: z.string().min(1).max(60),
    ref,
    orderId: z.uuid().optional(),
    providerPaymentId: z.string().max(80).optional(),
    refundId: z.string().optional(),
    amountPaise: paise.optional(),
    capturedPaise: paise.optional(),
    orderTotalPaise: paise.optional(),
  }),
  new_support_case: z.object({
    ref,
    caseId: z.string().min(1),
    type: z.enum(["damaged", "defective", "wrong", "missing", "other"]),
    description: text(2000),
  }),
  new_contact: z.object({
    name: text(120),
    email: text(200),
    orderRef: text(40).nullable().optional(),
    message: text(4000),
    messageId: z.string().optional(),
  }),
  outbox_failure: z.object({
    template: z.string().min(1).max(60),
    outboxId: z.string().min(1),
    attempts: z.number().int().nonnegative(),
    error: text(400),
    orderRef: text(40).nullable().optional(),
  }),
} as const;

export type PayloadSchemas = typeof payloadSchemas;
export type TemplateName = keyof PayloadSchemas;
export type PayloadOf<T extends TemplateName> = z.infer<PayloadSchemas[T]>;

/** Props of every template component. */
export interface TemplateProps<T extends TemplateName> {
  payload: PayloadOf<T>;
  ctx: EmailContext;
}
