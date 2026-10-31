import "server-only";

import { notificationOutbox } from "@/server/db/schema";
import { readSettings, type DbClient } from "@/server/services/queries/shared";
import { NOTIFICATION_EVENTS } from "@/server/services/settings-registry";

import type { TemplateName } from "../../../emails/payloads";

/**
 * Transactional outbox (plan 7.10). Callers pass the OPEN transaction of the state change, so the
 * row commits or rolls back with it. Delivery is `sender.ts`: it runs right after the response
 * (`dispatchOutboxSoon`) and again from the `notify-retry` cron, which retries with backoff.
 */

/** Every template that can be queued (all but `login_otp`, which is sent directly and never queued). */
export type NotificationTemplate = Exclude<TemplateName, "login_otp">;

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

/** Template name -> key in the `notification_channels` setting, where the two differ. */
const CHANNEL_EVENT: Partial<Record<NotificationTemplate, string>> = {
  cod_placed: "cod_order_placed",
  order_shipped: "shipped",
  order_delivered: "delivered",
  order_cancelled: "cancelled",
};

/** Customer message, skipped when the owner turned the e-mail channel off for that event. */
export async function enqueueCustomerNotification(tx: DbClient, input: EnqueueInput): Promise<boolean> {
  const eventKey = CHANNEL_EVENT[input.template] ?? input.template;
  if ((NOTIFICATION_EVENTS as readonly string[]).includes(eventKey)) {
    const { notification_channels } = await readSettings(tx, ["notification_channels"]);
    const flags = (notification_channels.value as Record<string, { email: boolean }>)[eventKey];
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
