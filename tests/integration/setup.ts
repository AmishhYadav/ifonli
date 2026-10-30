import { afterAll, beforeEach } from "vitest";

import { createSql, testDatabaseUrl } from "./helpers/db";

// Point the app's lazy `getDb()` at the test database before any app module is imported.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.DIRECT_URL = testDatabaseUrl();

const sql = createSql();

beforeEach(async () => {
  const tables = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  if (tables.length > 0) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
    await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
});

afterAll(async () => {
  await sql.end();
});
