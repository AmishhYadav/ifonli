import { after } from "next/server";

import { getDb } from "@/server/db";
import { handleEventsRequest } from "@/server/services/analytics/ingest";

const NO_STORE = { "Cache-Control": "no-store" };

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * First-party analytics beacon (plan 12): `POST { sessionId, events: [...] }`, sent by `track()` with
 * `navigator.sendBeacon`. Answers 204 at once and stores the events in `after()`, so it can never slow a
 * page down. Bots are ignored silently; everything else is validated (400), size limited (413) and rate
 * limited (429). The body is read as text because a beacon is sent as `text/plain` by some browsers.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const out = await handleEventsRequest(getDb(), {
      body: await req.text(),
      contentLength: Number(req.headers.get("content-length")) || null,
      userAgent: req.headers.get("user-agent"),
      origin: req.headers.get("origin"),
      host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
      ip: clientIp(req),
    });
    if (out.status === 204) {
      const { commit } = out;
      if (commit) {
        after(async () => {
          try {
            await commit();
          } catch (e) {
            console.error("analytics insert failed", e instanceof Error ? e.message : "unknown");
          }
        });
      }
      return new Response(null, { status: 204, headers: NO_STORE });
    }
    const headers: Record<string, string> = { ...NO_STORE };
    if (out.status === 429) headers["Retry-After"] = String(out.retryAfterSeconds);
    return Response.json({ ok: false, error: out.error }, { status: out.status, headers });
  } catch (e) {
    console.error("analytics ingest failed", e instanceof Error ? e.name : "unknown");
    return Response.json({ ok: false, error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
