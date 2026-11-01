import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { adminDatabaseUrl, TEST_DB_NAME, testDatabaseUrl } from "./helpers/db";

/**
 * Recreates `ifonli_test` from scratch and applies every migration, so each integration run also
 * proves the migrations apply cleanly to an empty database.
 *
 * It also reproduces what hosted Supabase does so the RLS lockdown migration (0005) has something
 * to undo: the `anon` / `authenticated` roles exist (plain Postgres has none; roles are
 * cluster-wide, so IF NOT EXISTS) and every table, sequence and function the owner creates in
 * `public` is granted to them by default. Tests then assert those grants are gone.
 */
export default async function globalSetup() {
  const admin = postgres(adminDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    for (const role of ["anon", "authenticated"]) {
      await admin.unsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
            CREATE ROLE ${role} NOLOGIN;
          END IF;
        EXCEPTION WHEN duplicate_object THEN NULL; -- created concurrently by another test database
        END $$`);
    }
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const client = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated`);
    await migrate(drizzle(client), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  } finally {
    await client.end();
  }
}
