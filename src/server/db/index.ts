import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getServerEnv } from "@/lib/env";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __ifonliDb?: Database };

/**
 * Lazily creates the Drizzle client (postgres.js, pooled URL). Lazy so that importing this
 * module at build time never requires a database. `prepare: false` keeps it compatible with
 * the Supabase transaction pooler.
 */
export function getDb(): Database {
  if (!globalForDb.__ifonliDb) {
    const client = postgres(getServerEnv().DATABASE_URL, { prepare: false });
    globalForDb.__ifonliDb = drizzle(client, { schema });
  }
  return globalForDb.__ifonliDb;
}
