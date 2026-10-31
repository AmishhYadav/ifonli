import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { EmailChannel, OutboundEmail, SendResult } from "./channel";

const SAFE = /[^a-z0-9]+/gi;

/**
 * Development channel: no provider key, so each e-mail is written to `.dev-mail/` as `.html` (open it in
 * a browser) plus a `.txt` twin, and one summary line is logged. The line carries the file name only:
 * no recipient, subject or code (the OTP e-mail's subject contains the code).
 */
export function createDevMailChannel(dir = path.join(process.cwd(), ".dev-mail")): EmailChannel {
  return {
    name: "dev-mail",
    async send(msg: OutboundEmail): Promise<SendResult> {
      try {
        await mkdir(dir, { recursive: true });
        const base = `${new Date().toISOString().replace(SAFE, "")}-${msg.idempotencyKey.replace(SAFE, "").slice(0, 12)}`;
        const header = `<!-- to: ${msg.to}\n     subject: ${msg.subject.replace(/--/g, "- -")}\n     attachments: ${msg.attachments?.map((a) => a.filename).join(", ") || "none"} -->\n`;
        await writeFile(path.join(dir, `${base}.html`), header + msg.html, "utf8");
        await writeFile(path.join(dir, `${base}.txt`), `To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`, "utf8");
        console.log(`[mail:dev] wrote .dev-mail/${base}.html`);
        return { ok: true, providerId: `dev-${base}` };
      } catch (e) {
        return { ok: false, error: `dev-mail:${e instanceof Error ? e.name : "write_failed"}`, retryable: true };
      }
    },
  };
}
