/**
 * PII / secret scrubbing for error reports (plan 13: "Sentry with PII scrubbing"). Pure and
 * dependency-free (runs in Node, Edge and the browser).
 *
 * Principle: events carry no request bodies, headers, cookies or user objects at all, so scrubbing
 * is a second line of defence for the free text that remains (error messages, URLs, stack frames):
 * emails, phone numbers, order tokens (`?t=`), bearer/signature tokens, connection strings, long opaque
 * ids (cart tokens, session ids) and 6-digit pincodes.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Indian mobile (optionally +91 / 0 prefix, with spaces or dashes), then any long +country number.
const PHONE_IN = /(?<![\w.])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
const PHONE_INTL = /(?<![\w.])\+\d[\d\s-]{8,14}\d(?!\d)/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const DB_URL = /\b(?:postgres(?:ql)?|mysql|redis|https?):\/\/[^\s'")]*:[^\s'")@]*@[^\s'")]+/gi;
const SENSITIVE_PARAM =
  /([?&;](?:t|token|access_token|otp|code|key|secret|signature|sig|razorpay_signature|razorpay_payment_id|email|phone|contact|password|pwd|auth)=)[^&#\s'"]*/gi;
const OPAQUE = /\b[A-Za-z0-9_-]{32,}\b/g;
const PINCODE = /(?<![\w.-])[1-9]\d{5}(?![\w-])/g;
// "Failed query: insert ... params: a@b.com,..." (drizzle) -> drop the bound values entirely.
const QUERY_PARAMS = /\bparams:\s.*$/is;

const MAX_MESSAGE = 300;

/** Scrubs free text (error messages, log lines). */
export function scrubText(input: string, max: number = MAX_MESSAGE): string {
  let out = input.replace(QUERY_PARAMS, "params: [redacted]");
  out = out
    .replace(DB_URL, "[url]")
    .replace(BEARER, "Bearer [token]")
    .replace(SENSITIVE_PARAM, "$1[token]")
    .replace(EMAIL, "[email]")
    .replace(PHONE_INTL, "[phone]")
    .replace(PHONE_IN, "[phone]")
    .replace(OPAQUE, "[redacted]")
    .replace(PINCODE, "[pin]");
  return out.length > max ? `${out.slice(0, max)}...` : out;
}

/**
 * Scrubs a URL or path: the query string is reduced to its parameter NAMES (values removed), the
 * fragment is dropped, and order refs in `/orders/<ref>` and `/api/orders/<ref>/...` are masked.
 */
export function scrubUrl(input: string): string {
  let path = input;
  let query = "";
  const hash = path.indexOf("#");
  if (hash >= 0) path = path.slice(0, hash);
  const q = path.indexOf("?");
  if (q >= 0) {
    query = path.slice(q + 1);
    path = path.slice(0, q);
  }
  path = path.replace(/(\/orders\/)[^/]+/g, "$1[ref]").replace(/(\/track\/)[^/]+/g, "$1[ref]");
  path = scrubText(path, 400);
  const names = query
    .split("&")
    .map((pair) => pair.split("=")[0]?.slice(0, 30) ?? "")
    .filter(Boolean)
    .slice(0, 8);
  return names.length > 0 ? `${path}?${names.map((n) => `${n}=[v]`).join("&")}` : path;
}

export interface ScrubbedFrame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/** Trims a stack file path to something stable and free of machine/user directories. */
export function shortenFilename(file: string): string {
  const cleaned = file.replace(/^file:\/\//, "").split("?")[0] ?? "";
  for (const marker of ["/.next/", "/src/", "/node_modules/"]) {
    const idx = cleaned.lastIndexOf(marker);
    if (idx >= 0) return cleaned.slice(idx + 1);
  }
  try {
    const url = new URL(cleaned);
    return url.pathname.slice(1) || url.host;
  } catch {
    return cleaned.split("/").slice(-2).join("/");
  }
}

const FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

/** Parses a V8-style stack into Sentry frames (oldest call first), keeping at most `max` innermost frames. */
export function parseStack(stack: string | undefined, max = 30): ScrubbedFrame[] {
  if (!stack) return [];
  const frames: ScrubbedFrame[] = [];
  for (const line of stack.split("\n")) {
    const m = FRAME.exec(line);
    if (!m) continue;
    const filename = shortenFilename(m[2] ?? "");
    frames.push({
      filename,
      ...(m[1] ? { function: scrubText(m[1], 80) } : {}),
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes("node_modules/"),
    });
    if (frames.length >= max) break;
  }
  return frames.reverse();
}
