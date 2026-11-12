import "server-only";

import { getServerEnv } from "@/lib/env";

import { createBrevoChannel } from "./brevo";
import { NotifyConfigError, type EmailChannel } from "./channel";
import { createDevMailChannel } from "./dev-mail";
import { createResendChannel } from "./email";

export interface ChannelEnv {
  apiKey?: string;
  brevoApiKey?: string;
  from?: string;
  nodeEnv?: string;
}

/**
 * Picks the e-mail channel from the environment:
 *  - `BREVO_API_KEY` set -> Brevo (requires `EMAIL_FROM`, a sender verified in Brevo);
 *  - else `RESEND_API_KEY` set -> Resend (requires `EMAIL_FROM`);
 *  - no key outside production -> files in `.dev-mail/`;
 *  - no key in production -> `NotifyConfigError` (e-mail is required at launch: never drop silently).
 */
export function resolveEmailChannel(env?: ChannelEnv): EmailChannel {
  const s = env ? null : getServerEnv();
  const e = env ?? { apiKey: s!.RESEND_API_KEY, brevoApiKey: s!.BREVO_API_KEY, from: s!.EMAIL_FROM, nodeEnv: s!.NODE_ENV };
  if (e.brevoApiKey || e.apiKey) {
    if (!e.from) throw new NotifyConfigError("EMAIL_FROM is required when an e-mail API key is set");
    return e.brevoApiKey ? createBrevoChannel({ apiKey: e.brevoApiKey, from: e.from }) : createResendChannel({ apiKey: e.apiKey!, from: e.from });
  }
  if (e.nodeEnv === "production") {
    throw new NotifyConfigError("Neither BREVO_API_KEY nor RESEND_API_KEY is set: e-mail cannot be sent in production");
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
