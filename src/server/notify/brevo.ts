import "server-only";

import type { EmailChannel, OutboundEmail, SendResult } from "./channel";

const ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const TIMEOUT_MS = 15_000;

/**
 * Brevo adapter (transactional API). Works without an own domain: the sender is a single address
 * verified in Brevo (Senders > Add sender), and Brevo rewrites a free-mail From to its own domain.
 *
 * Brevo has no idempotency keys, so a retry after a timeout whose send actually went through can
 * deliver twice. The outbox row id travels in `X-Mailin-custom` so a duplicate can be traced in Brevo's logs.
 */
export function createBrevoChannel(opts: { apiKey: string; from: string; fetchImpl?: typeof fetch }): EmailChannel {
  const sender = parseFrom(opts.from);
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: "brevo",
    async send(msg: OutboundEmail): Promise<SendResult> {
      let res: Response;
      try {
        res = await doFetch(ENDPOINT, {
          method: "POST",
          headers: { "api-key": opts.apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            sender,
            to: [{ email: msg.to }],
            subject: msg.subject,
            htmlContent: msg.html,
            textContent: msg.text,
            attachment: msg.attachments?.map((a) => ({ name: a.filename, content: a.content.toString("base64") })),
            headers: { "X-Mailin-custom": `outbox:${msg.idempotencyKey}` },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        // Network failure / timeout: the message may or may not have left.
        return { ok: false, error: `brevo:${e instanceof Error ? e.name : "network_error"}`, retryable: true };
      }
      const body = (await res.json().catch(() => null)) as { messageId?: string; code?: string } | null;
      if (res.ok) {
        return body?.messageId ? { ok: true, providerId: body.messageId } : { ok: false, error: "brevo:no_id", retryable: true };
      }
      return { ok: false, error: `brevo:${body?.code ?? "http"}_${res.status}`, retryable: isBrevoRetryable(res.status) };
    },
  };
}

/** 429 (rate limit), 402 (daily quota or credits used up) and 5xx clear up on their own; the rest are our fault. */
export function isBrevoRetryable(status: number): boolean {
  return status === 429 || status === 402 || status >= 500;
}

/** `IfOnli <shop@x.com>` or a bare `shop@x.com` into Brevo's `{ name, email }` sender. */
export function parseFrom(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!m) return { email: from.trim() };
  const name = m[1]!.replace(/^"|"$/g, "").trim();
  return name ? { name, email: m[2]!.trim() } : { email: m[2]!.trim() };
}
