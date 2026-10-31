import "server-only";

import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";

import { invoices, notificationOutbox } from "@/server/db/schema";
import type { DbClient } from "@/server/services/queries/shared";

import { payloadSchemas } from "../../../emails/payloads";
import type { EmailContext } from "../../../emails/types";
import type { EmailChannel, OutboundAttachment, SendResult } from "./channel";
import { loadEmailContext } from "./context";
import { getEmailChannel, resolveEmailChannel, type ChannelEnv } from "./email-channel";
import { enqueueAdminAlert } from "./outbox";
import { isTemplateName, renderTemplate, TEMPLATES } from "./templates";
import { getWhatsAppChannel, type WhatsAppChannel } from "./whatsapp";

/** Total tries per row (the first send is attempt 1). After the last failure the row is `failed` and an admin is alerted. */
export const MAX_ATTEMPTS = 6;
/** A claimed row is invisible to other processors for this long; a crashed processor's rows come back after it. */
export const LEASE_MS = 10 * 60_000;
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_CAP_MS = 6 * 60 * 60_000;

/** Wait before the next try once attempt `attempt` (1-based) failed: 5, 10, 20, 40, 80 min ... capped at 6h. */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_CAP_MS);
}

/** Stored in `last_error` and alert e-mails: bounded, and scrubbed of anything that looks like an address or number. */
export function sanitizeError(message: string): string {
  return message
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export interface ProcessOutboxOptions {
  limit?: number;
  now?: Date;
  maxAttempts?: number;
  /** Tests inject fakes; production resolves Resend (or the dev-mail files) from the environment. */
  channel?: EmailChannel;
  /** Resolve the channel from this environment instead of the process one (tests of the config error path). */
  env?: ChannelEnv;
  whatsapp?: WhatsAppChannel;
  /** Skip building the invoice PDF attachment (default: attach where the template wants it). */
  attachInvoice?: boolean;
}

export interface ProcessOutboxResult {
  claimed: number;
  sent: number;
  /** Failed but will be tried again. */
  retrying: number;
  /** Permanently failed (an admin alert row was written). */
  failed: number;
}

type OutboxRow = typeof notificationOutbox.$inferSelect;

/**
 * Sends due `pending` outbox rows (plan 7.10). Safe to run from many places at once (the request-path
 * `after()` hook and the `notify-retry` cron): rows are claimed with `FOR UPDATE SKIP LOCKED`, and the claim
 * itself pushes `next_attempt_at` out by a lease, so no two processors work the same row and no row lock
 * is held while talking to the provider. The provider call carries the row id as an idempotency key.
 *
 * Throws `NotifyConfigError` (before claiming anything) when e-mail is not configured in production.
 */
export async function processOutbox(db: DbClient, opts: ProcessOutboxOptions = {}): Promise<ProcessOutboxResult> {
  const channel = opts.channel ?? (opts.env ? resolveEmailChannel(opts.env) : getEmailChannel());
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const clock = () => opts.now ?? new Date();
  const limit = Math.min(Math.max(1, opts.limit ?? 25), 200);

  // JS dates have millisecond precision while `now()` defaults are microseconds: compare at
  // millisecond precision, or a row queued a fraction of a millisecond earlier looks "not yet due".
  const claimedAt = clock();
  const dueBefore = new Date(claimedAt.getTime() + 1);
  const rows = await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(notificationOutbox)
      .where(and(eq(notificationOutbox.status, "pending"), lt(notificationOutbox.nextAttemptAt, dueBefore)))
      .orderBy(asc(notificationOutbox.nextAttemptAt), asc(notificationOutbox.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [] as OutboxRow[];
    await tx
      .update(notificationOutbox)
      .set({ attempts: sql`${notificationOutbox.attempts} + 1`, nextAttemptAt: new Date(claimedAt.getTime() + LEASE_MS) })
      .where(inArray(notificationOutbox.id, due.map((r) => r.id)));
    return due.map((r) => ({ ...r, attempts: r.attempts + 1 }));
  });

  const out: ProcessOutboxResult = { claimed: rows.length, sent: 0, retrying: 0, failed: 0 };
  for (const row of rows) {
    let result: SendResult;
    try {
      result = await deliver(db, row, channel, opts);
    } catch (e) {
      // Render / lookup problems are bugs or bad data: retrying the identical input cannot help.
      result = { ok: false, error: `${row.template}:${e instanceof Error ? e.name : "error"} ${e instanceof Error ? e.message : ""}`, retryable: false };
    }
    if (result.ok) {
      await db
        .update(notificationOutbox)
        .set({ status: "sent", sentAt: clock(), providerId: result.providerId, lastError: null })
        .where(and(eq(notificationOutbox.id, row.id), eq(notificationOutbox.status, "pending")));
      out.sent += 1;
      continue;
    }
    const error = sanitizeError(result.error);
    if (result.retryable && row.attempts < maxAttempts) {
      await db
        .update(notificationOutbox)
        .set({ lastError: error, nextAttemptAt: new Date(clock().getTime() + backoffMs(row.attempts)) })
        .where(and(eq(notificationOutbox.id, row.id), eq(notificationOutbox.status, "pending")));
      out.retrying += 1;
    } else {
      await db
        .update(notificationOutbox)
        .set({ status: "failed", lastError: error })
        .where(and(eq(notificationOutbox.id, row.id), eq(notificationOutbox.status, "pending")));
      out.failed += 1;
      await raiseFailureAlert(db, row, error);
    }
  }
  return out;
}

async function deliver(db: DbClient, row: OutboxRow, channel: EmailChannel, opts: ProcessOutboxOptions): Promise<SendResult> {
  if (row.channel === "whatsapp") {
    return (opts.whatsapp ?? getWhatsAppChannel()).send({ to: row.to, template: row.template, params: [], idempotencyKey: row.id });
  }
  if (!isTemplateName(row.template)) return { ok: false, error: `unknown template ${row.template}`, retryable: false };

  const def = TEMPLATES[row.template];
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  // Validate first so a bad payload fails before any lookups or PDF work.
  payloadSchemas[row.template].parse(payload);

  const orderId = row.orderId ?? (typeof payload.orderId === "string" ? payload.orderId : null);
  const ctx: EmailContext = await loadEmailContext(db, { orderId, audience: def.audience });
  const attachments = def.attachInvoice && orderId && opts.attachInvoice !== false ? await invoiceAttachments(db, orderId) : [];
  ctx.invoiceAttached = attachments.length > 0;

  const rendered = await renderTemplate(row.template, payload, ctx);
  try {
    return await channel.send({
      to: row.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments: attachments.length > 0 ? attachments : undefined,
      idempotencyKey: row.id,
    });
  } catch (e) {
    // An adapter that throws instead of returning a result: assume transient (the idempotency key makes a retry safe).
    return { ok: false, error: `${channel.name}:${e instanceof Error ? e.name : "threw"}`, retryable: true };
  }
}

/**
 * The order's invoice as a PDF attachment. Best effort: an order without an invoice number yet, or any
 * rendering problem, sends the e-mail without it (the invoice stays downloadable from the order page).
 * Loaded lazily: the PDF renderer is heavy and only these templates need it.
 */
async function invoiceAttachments(db: DbClient, orderId: string): Promise<OutboundAttachment[]> {
  try {
    const [inv] = await db.select({ number: invoices.number }).from(invoices).where(eq(invoices.orderId, orderId)).limit(1);
    if (!inv) return [];
    const { buildInvoiceModel, renderInvoicePdf } = await import("@/server/services/invoices");
    const pdf = await renderInvoicePdf(await buildInvoiceModel(db, orderId));
    return [{ filename: `Invoice-${inv.number.replace(/\//g, "-")}.pdf`, content: pdf, contentType: "application/pdf" }];
  } catch (e) {
    console.error("invoice attachment skipped:", e instanceof Error ? e.name : "unknown");
    return [];
  }
}

/** Tells the admins an e-mail was given up on. Never for a failed alert itself (no alert loops). */
async function raiseFailureAlert(db: DbClient, row: OutboxRow, error: string): Promise<void> {
  console.error(`notification ${row.id} (${row.template}) failed after ${row.attempts} attempt(s): ${error}`);
  if (row.template === "outbox_failure") return;
  try {
    const ref = (row.payload as { ref?: unknown } | null)?.ref;
    await enqueueAdminAlert(db, {
      orderId: row.orderId,
      template: "outbox_failure",
      payload: { template: row.template, outboxId: row.id, attempts: row.attempts, error, orderRef: typeof ref === "string" ? ref : null },
    });
  } catch (e) {
    console.error("could not raise outbox failure alert:", e instanceof Error ? e.name : "unknown");
  }
}
