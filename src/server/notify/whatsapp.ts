import "server-only";

/**
 * WhatsApp adapter seam (plan decision 21): the provider is still to be chosen, and WhatsApp stays
 * off until then. `notification_outbox.channel` already allows `whatsapp`, and the sender routes such
 * rows here. A real provider (Meta Cloud API, Gupshup, ...) implements `WhatsAppChannel` using
 * pre-approved template messages (`template` + ordered `params`) and is returned from `getWhatsAppChannel`.
 */
export interface WhatsAppMessage {
  /** E.164 number. */
  to: string;
  /** Approved template name at the provider. */
  template: string;
  params: string[];
  idempotencyKey: string;
}

export type WhatsAppResult =
  | { ok: true; providerId: string }
  | { ok: false; error: string; retryable: boolean };

export interface WhatsAppChannel {
  readonly name: string;
  send(message: WhatsAppMessage): Promise<WhatsAppResult>;
}

/** No provider configured: every send is a permanent, non-retryable "disabled" failure. */
export const disabledWhatsAppChannel: WhatsAppChannel = {
  name: "whatsapp-disabled",
  async send() {
    return { ok: false, error: "whatsapp:disabled", retryable: false };
  },
};

export function getWhatsAppChannel(): WhatsAppChannel {
  return disabledWhatsAppChannel;
}
