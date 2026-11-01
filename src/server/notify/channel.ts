import "server-only";

/**
 * Delivery channel port (plan 7.10). The sender talks to this interface only, so e-mail providers
 * (Resend in production, files in dev, a fake in tests) and WhatsApp are interchangeable.
 */
export interface OutboundAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: OutboundAttachment[];
  /** Provider-side de-duplication key: the outbox row id, so a retry after a lost reply never double-sends. */
  idempotencyKey: string;
}

export type SendResult =
  /** `note` is kept on the outbox row (`last_error`) when the send counts as done for a reason worth remembering. */
  | { ok: true; providerId: string; note?: string }
  /** `retryable: false` = the provider rejected the message itself (bad address, invalid key): retrying cannot help. */
  | { ok: false; error: string; retryable: boolean };

export interface EmailChannel {
  readonly name: string;
  send(message: OutboundEmail): Promise<SendResult>;
}

/** Misconfiguration that must stop sending loudly (never a silent drop). */
export class NotifyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotifyConfigError";
  }
}
