import "server-only";

import { getLaunchReadiness } from "@/server/services/admin/launch";

import type { DbClient } from "../queries/shared";

/**
 * The launch gate for taking orders (plan section 14): a production deploy refuses real orders, prepaid
 * and COD alike, while the launch checklist (Admin > Settings) still has blockers. Development, tests
 * and review builds made with `NEXT_PUBLIC_ENABLE_DEV_PAGES=1` are never gated.
 */

export interface OrderGate {
  /** True when orders may be placed. */
  open: boolean;
  /** Launch blockers left (0 when the gate is not enforced). */
  blockers: number;
}

type Env = Record<string, string | undefined>;

/** Customer-facing text for a closed gate. Never names what is missing: that is for the owner. */
export const STORE_CLOSED_MESSAGE =
  "We're not taking orders yet. We're still getting the shop ready, so please check back soon.";

/** True on a real production deploy (not `next dev`, tests, or a review build with dev pages on). */
export function launchGateEnforced(env: Env = process.env as Env): boolean {
  return env.NODE_ENV === "production" && env.NEXT_PUBLIC_ENABLE_DEV_PAGES !== "1";
}

/**
 * How long a readiness answer is reused. Changing a setting or publishing a policy reaches the gate
 * within this time on every server instance; checkout is the hot path, the checklist is ~10 queries.
 */
const CACHE_TTL_MS = 60_000;

let cached: { at: number; gate: OrderGate } | null = null;
let inflight: Promise<OrderGate> | null = null;

/** Forgets the cached answer (tests, and anything that wants the next order to re-check). */
export function resetOrderGateCache(): void {
  cached = null;
  inflight = null;
}

/**
 * Whether orders may be placed right now. Only the blocking part of the checklist is computed (no
 * content warnings) and the result is cached for a minute per server instance.
 */
export async function getOrderGate(
  db: DbClient,
  opts: { env?: Env; now?: Date } = {},
): Promise<OrderGate> {
  const env = opts.env ?? (process.env as Env);
  if (!launchGateEnforced(env)) return { open: true, blockers: 0 };

  const now = opts.now ?? new Date();
  if (cached && now.getTime() - cached.at < CACHE_TTL_MS && now.getTime() >= cached.at) return cached.gate;
  inflight ??= getLaunchReadiness(db, { env, now, blockersOnly: true })
    .then((r) => {
      const gate: OrderGate = { open: r.ready, blockers: r.blockers };
      cached = { at: now.getTime(), gate };
      return gate;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
