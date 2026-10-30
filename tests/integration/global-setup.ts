import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { adminDatabaseUrl, TEST_DB_NAME, testDatabaseUrl } from "./helpers/db";

/**
 * Recreates `ifonli_test` from scratch and applies every migration, so each integration run also
 * proves the migrations apply cleanly to an empty database.
 */
export default async function globalSetup() {
  const admin = postgres(adminDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const client = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  } finally {
    await client.end();
  }
}
