import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/lib/env";

/**
 * Cron endpoints accept only `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends exactly that).
 * Both sides are hashed first so the comparison is constant time regardless of length. With no
 * `CRON_SECRET` configured every request is rejected (never "open by default").
 */
export function isCronAuthorized(req: Request, secretOverride?: string | null): boolean {
  const secret = secretOverride === undefined ? getServerEnv().CRON_SECRET : secretOverride;
  if (!secret) return false;
  const presented = req.headers.get("authorization") ?? "";
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

export function cronUnauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
