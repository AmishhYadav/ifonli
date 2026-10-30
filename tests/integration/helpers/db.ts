import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

/** Override with IFONLI_TEST_DB to run several integration suites in parallel (one database each). */
export const TEST_DB_NAME = process.env.IFONLI_TEST_DB || "ifonli_test";
if (!/^[a-z_][a-z0-9_]*$/.test(TEST_DB_NAME)) throw new Error(`Invalid IFONLI_TEST_DB: ${TEST_DB_NAME}`);

function baseUrl(): URL {
  const raw =
    process.env.TEST_ADMIN_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!raw)
    throw new Error(
      "Set DIRECT_URL or DATABASE_URL (local Supabase Postgres) to run integration tests",
    );
  return new URL(raw);
}

/** Connection string for the throwaway test database (same server, database `TEST_DB_NAME`). */
export function testDatabaseUrl(): string {
  const url = baseUrl();
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

/** Connection to the server's maintenance database, used to (re)create the test database. */
export function adminDatabaseUrl(): string {
  const url = baseUrl();
  url.pathname = "/postgres";
  return url.toString();
}

export function createSql(url = testDatabaseUrl()) {
  return postgres(url, { max: 4, onnotice: () => {} });
}
