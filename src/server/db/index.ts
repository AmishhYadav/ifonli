import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getServerEnv } from "@/lib/env";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __ifonliDb?: Database };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Connection options for postgres.js. Each serverless instance holds a few connections, not the
 * library default of 10: with many instances in parallel the Supabase pooler runs out of client
 * slots long before the database is busy. Idle connections are dropped after 20 s, and a connect
 * that hangs gives up after 10 s. TLS is required for any host that is not this machine (local
 * Docker and the CI Postgres have none). `prepare: false` keeps it compatible with the Supabase
 * transaction pooler.
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
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ...(local ? {} : { ssl: "require" as const }),
  };
}

/**
 * Lazily creates the Drizzle client (postgres.js, pooled URL). Lazy so that importing this
 * module at build time never requires a database.
 */
export function getDb(): Database {
  if (!globalForDb.__ifonliDb) {
    const url = getServerEnv().DATABASE_URL;
    const client = postgres(url, connectionOptions(url));
    globalForDb.__ifonliDb = drizzle(client, { schema });
  }
  return globalForDb.__ifonliDb;
}
