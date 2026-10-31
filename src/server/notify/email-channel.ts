import "server-only";

import { getServerEnv } from "@/lib/env";

import { NotifyConfigError, type EmailChannel } from "./channel";
import { createDevMailChannel } from "./dev-mail";
import { createResendChannel } from "./email";

export interface ChannelEnv {
  apiKey?: string;
  from?: string;
  nodeEnv?: string;
}

/**
 * Picks the e-mail channel from the environment:
 *  - `RESEND_API_KEY` set -> Resend (requires `EMAIL_FROM`);
 *  - no key outside production -> files in `.dev-mail/`;
 *  - no key in production -> `NotifyConfigError` (e-mail is required at launch: never drop silently).
 */
export function resolveEmailChannel(env?: ChannelEnv): EmailChannel {
  const e = env ?? { apiKey: getServerEnv().RESEND_API_KEY, from: getServerEnv().EMAIL_FROM, nodeEnv: getServerEnv().NODE_ENV };
  if (e.apiKey) {
    if (!e.from) throw new NotifyConfigError("EMAIL_FROM is required when RESEND_API_KEY is set");
    return createResendChannel({ apiKey: e.apiKey, from: e.from });
  }
  if (e.nodeEnv === "production") {
    throw new NotifyConfigError("RESEND_API_KEY is not set: e-mail cannot be sent in production");
  }
  return createDevMailChannel();
}

let override: EmailChannel | null = null;

/** Tests inject a fake channel here (pass `null` to restore). */
export function setEmailChannelOverride(channel: EmailChannel | null): void {
  override = channel;
}

export function getEmailChannel(): EmailChannel {
  return override ?? resolveEmailChannel();
}
