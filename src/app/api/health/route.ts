import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { getDb } from "@/server/db";

/**
 * GET /api/health: liveness + database reachability for uptime monitors (point UptimeRobot / Better
 * Stack / Vercel checks here). Exposes no secrets or data: only status, DB round-trip time and the
 * short release id. 200 when the database answers inside the timeout, 503 otherwise. Never cached.
 * The result is memoised for a few seconds per instance so a monitor (or an attacker) cannot turn
 * this route into a database load generator.
 */
const DB_TIMEOUT_MS = 2000;
const MEMO_MS = 5000;
const HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } as const;

interface Probe {
  ok: boolean;
  ms: number;
  at: number;
}
let memo: Probe | null = null;

async function probeDatabase(): Promise<Probe> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, ms: Date.now() - started, at: Date.now() };
  } catch {
    return { ok: false, ms: Date.now() - started, at: Date.now() };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  await connection(); // never prerender: this must run per request
  if (!memo || Date.now() - memo.at > MEMO_MS) memo = await probeDatabase();
  const release = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  return Response.json(
    {
      status: memo.ok ? "ok" : "degraded",
      db: memo.ok ? "ok" : "down",
      dbMs: memo.ms,
      release,
      time: new Date().toISOString(),
    },
    { status: memo.ok ? 200 : 503, headers: HEADERS },
  );
}
