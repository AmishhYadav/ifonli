import "server-only";

import { Resend } from "resend";

import type { EmailChannel, OutboundEmail, SendResult } from "./channel";

/**
 * Resend adapter. The outbox row id travels as Resend's idempotency key (valid for 24h), so a retry
 * after a timeout or a crash between "sent" and "marked sent" cannot deliver twice.
 */
export function createResendChannel(opts: { apiKey: string; from: string }): EmailChannel {
  const client = new Resend(opts.apiKey);
  return {
    name: "resend",
    async send(msg: OutboundEmail): Promise<SendResult> {
      try {
        const { data, error } = await client.emails.send(
          {
            from: opts.from,
            to: msg.to,
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
            attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
          },
          { idempotencyKey: msg.idempotencyKey },
        );
        // The same row id was already sent (Resend remembers keys for 24 h) and the retry's content
        // differs, e.g. because a template changed in between. The first send did go out.
        if (error?.name === "invalid_idempotent_request") {
          return { ok: true, providerId: `resend:replay:${msg.idempotencyKey}`, note: "resend:invalid_idempotent_request, treated as already sent" };
        }
        if (error) return { ok: false, error: `resend:${error.name}`, retryable: isRetryable(error.name, error.statusCode) };
        return data?.id ? { ok: true, providerId: data.id } : { ok: false, error: "resend:no_id", retryable: true };
      } catch (e) {
        // Network failure / timeout: the message may or may not have left; the idempotency key makes a retry safe.
        return { ok: false, error: `resend:${e instanceof Error ? e.name : "network_error"}`, retryable: true };
      }
    },
  };
}

/** 429, 5xx, a concurrent duplicate request and network errors are worth retrying; the rest are our fault. */
export function isRetryable(name: string, statusCode: number | null): boolean {
  if (name === "rate_limit_exceeded" || name === "concurrent_idempotent_requests") return true;
  if (name === "application_error" || name === "internal_server_error") return true;
  if (name === "daily_quota_exceeded" || name === "monthly_quota_exceeded") return true;
  if (statusCode === null) return true;
  return statusCode === 429 || statusCode >= 500;
}
