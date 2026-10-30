import "server-only";

import { notificationOutbox } from "@/server/db/schema";
import { readSettings, type DbClient } from "@/server/services/queries/shared";
import { NOTIFICATION_EVENTS } from "@/server/services/settings-registry";

/**
 * Transactional outbox (plan 7.10). Callers pass the OPEN transaction of the state change, so the
 * row commits or rolls back with it. Sending (Resend / WhatsApp), retries and backoff are a later
 * phase: until then rows simply sit `pending` with `next_attempt_at = now`.
 */

/** Templates written by the payment flows. Customer templates come first. */
export type NotificationTemplate =
  | "order_confirmed"
  | "refund_initiated"
  | "refund_processed"
  | "payment_late_refund"
  | "new_order"
  | "payment_anomaly";

export interface EnqueueInput {
  orderId?: string | null;
  template: NotificationTemplate;
  /** Recipient e-mail address. */
  to: string;
  /** JSON-serialisable template data. Keep PII to what the template needs. */
  payload?: Record<string, unknown>;
}

export async function enqueueNotification(tx: DbClient, input: EnqueueInput): Promise<void> {
  await tx.insert(notificationOutbox).values({
    orderId: input.orderId ?? null,
    channel: "email",
    template: input.template,
    to: input.to,
    payload: input.payload ?? {},
  });
}

/** Customer message, skipped when the owner turned the e-mail channel off for that event. */
export async function enqueueCustomerNotification(tx: DbClient, input: EnqueueInput): Promise<boolean> {
  if ((NOTIFICATION_EVENTS as readonly string[]).includes(input.template)) {
    const { notification_channels } = await readSettings(tx, ["notification_channels"]);
    const flags = (notification_channels.value as Record<string, { email: boolean }>)[input.template];
    if (flags && !flags.email) return false;
  }
  await enqueueNotification(tx, input);
  return true;
}

/** One row per configured admin recipient (`admin_alert_emails`). */
export async function enqueueAdminAlert(
  tx: DbClient,
  input: Omit<EnqueueInput, "to">,
): Promise<number> {
  const { admin_alert_emails } = await readSettings(tx, ["admin_alert_emails"]);
  const recipients = [...new Set(admin_alert_emails.value)];
  for (const to of recipients) await enqueueNotification(tx, { ...input, to });
  return recipients.length;
}
