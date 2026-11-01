/**
 * Empties the admin sign-in / enrolment rate-limit buckets on a LOCAL database (see admin-account.ts).
 *   pnpm exec tsx tests/e2e/helpers/clear-admin-rate-limits.ts
 * Does nothing when DATABASE_URL points anywhere else.
 */
import { config } from "dotenv";
import postgres from "postgres";

import { isLocalDatabase } from "../../../scripts/db-guard";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !isLocalDatabase(url)) return;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`DELETE FROM rate_limits WHERE key LIKE 'admin-%'`;
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
