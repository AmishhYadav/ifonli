import { afterAll, beforeEach } from "vitest";

import { createSql, testDatabaseUrl } from "./helpers/db";

// Point the app's lazy `getDb()` at the test database before any app module is imported.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.DIRECT_URL = testDatabaseUrl();

// Most suites place many orders with the one factory contact; the per-contact daily order budgets
// (`commerce/contact-limits`) are relaxed for them exactly as for the e2e run. The suite that tests
// the budgets passes `enforceContactLimits: true` (or unsets this).
process.env.E2E_MOCK_CHECKOUT = "1";

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
