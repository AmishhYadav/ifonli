import "server-only";

/** Best-effort client IP for rate-limit keys (Vercel sets x-forwarded-for; never trust it for auth). */
export function clientIpFromHeaders(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown"
  );
}

/** Reads a request body as text, refusing anything above `maxBytes` (null = too large). */
export async function readTextLimited(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const text = await req.text();
  return text.length > maxBytes ? null : text;
}
