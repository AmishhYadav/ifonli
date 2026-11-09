import "server-only";

import { waitUntil } from "@vercel/functions";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getServerEnv } from "@/lib/env";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __ifonliDb?: Database };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Seconds an unused connection to a remote database stays open (see `keepAliveUntilIdle`). */
export const REMOTE_IDLE_TIMEOUT_S = 5;

/**
 * Connection options for postgres.js. TLS is required for any host that is not this machine (local
 * Docker and the CI Postgres have none), and a connect that hangs gives up after 10 s. `prepare:
 * false` keeps it compatible with the Supabase poolers.
 *
 * Remote databases (Supabase session pooler, which allows only `pool_size` clients in total: 15 on
 * the Free plan) get 2 connections per instance and a 5 s idle timeout, so many serverless
 * instances fit and an idle one gives its slots back quickly. Local databases keep 5 / 20 s.
 */
export function connectionOptions(url: string): postgres.Options<Record<string, never>> {
  let local = false;
  try {
    local = LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    // An unparsable URL fails at connect time; do not weaken TLS for it.
  }
  return {
    prepare: false,
    max: local ? 5 : 2,
    idle_timeout: local ? 20 : REMOTE_IDLE_TIMEOUT_S,
    connect_timeout: 10,
    ...(local ? {} : { ssl: "require" as const }),
  };
}

/**
 * Vercel Fluid compute suspends an instance between requests, and a suspended instance's timers do
 * not run: postgres.js's idle timeout never fires, so its connections stay open and the pooler's
 * client slots fill up (EMAXCONNSESSION) until the instance is shut down. Like `attachDatabasePool`
 * from `@vercel/functions` (which does not support postgres.js), every query keeps the instance
 * running until the idle timeout has passed after the last one, through `waitUntil`, so idle
 * connections are closed before it is suspended. Only on a Vercel runtime (not builds, not locally).
 */
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let releaseIdleWait: () => void = () => {};

function keepAliveUntilIdle(): void {
  if (!process.env.VERCEL_URL || !process.env.VERCEL_REGION) return;
  if (idleTimer) {
    clearTimeout(idleTimer);
    releaseIdleWait();
  }
  const done = new Promise<void>((resolve) => {
    releaseIdleWait = resolve;
  });
  // Covers the query itself (logged before it runs) plus the idle timeout and a margin.
  idleTimer = setTimeout(() => {
    idleTimer = null;
    releaseIdleWait();
  }, (REMOTE_IDLE_TIMEOUT_S + 3) * 1000);
  waitUntil(done);
}

/**
 * Lazily creates the Drizzle client (postgres.js, pooled URL). Lazy so that importing this
 * module at build time never requires a database.
 */
export function getDb(): Database {
  if (!globalForDb.__ifonliDb) {
    const url = getServerEnv().DATABASE_URL;
    const client = postgres(url, connectionOptions(url));
    globalForDb.__ifonliDb = drizzle(client, { schema, logger: { logQuery: keepAliveUntilIdle } });
  }
  return globalForDb.__ifonliDb;
}
