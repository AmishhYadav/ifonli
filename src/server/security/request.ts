import "server-only";

/** Best-effort client IP for rate-limit keys (Vercel sets x-forwarded-for; never trust it for auth). */
export function clientIpFromHeaders(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown"
  );
}

/**
 * Reads a request body as text, refusing anything above `maxBytes` BYTES (null = too large).
 *
 * The body is streamed with a running byte count and the read stops (the rest is cancelled, never
 * buffered) the moment the count passes the cap, so a chunked upload with no `Content-Length`, or one
 * that lies about it, cannot make the server hold an unbounded body. The bytes are decoded as UTF-8
 * exactly like `req.text()` does (a leading BOM is dropped, invalid sequences become U+FFFD), in one
 * go over the whole body so a multi-byte character split across chunks decodes correctly: callers
 * such as the Razorpay webhook verify a signature over this exact string.
 */
export async function readTextLimited(req: Request, maxBytes: number): Promise<string | null> {
  const declaredHeader = req.headers.get("content-length");
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (Number.isFinite(declared) && declared > maxBytes) return null;
  }
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}
