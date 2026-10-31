/**
 * Puts the content the admin-content e2e touches back to its freshly seeded state, so the spec can be
 * re-run against the same dev database:
 *   pnpm exec tsx tests/e2e/helpers/reset-content.ts
 *
 * - the `shipping` policy goes back to an unpublished draft at version 1 (later draft versions removed);
 * - `support_hours` and `flat_fee` become placeholders again.
 * Uses DATABASE_URL like every other script; refuses anything that looks like production.
 */
import { config } from "dotenv";
import postgres from "postgres";

import { SETTINGS } from "../../../src/server/services/settings-registry";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset content in production");

async function main() {
  const sql = postgres(url as string, { max: 1, onnotice: () => {} });
  try {
    await sql`
      DELETE FROM policy_versions
      WHERE version > 1 AND policy_id IN (SELECT id FROM policies WHERE slug = 'shipping')`;
    await sql`
      UPDATE policy_versions SET published_by = NULL, effective_at = NULL
      WHERE policy_id IN (SELECT id FROM policies WHERE slug = 'shipping')`;
    await sql`
      UPDATE policies SET published = false, effective_at = NULL, version = 1
      WHERE slug = 'shipping'`;
    for (const key of ["support_hours", "flat_fee"] as const) {
      const value = SETTINGS[key].schema.parse(SETTINGS[key].placeholder);
      await sql`
        UPDATE settings SET value = ${sql.json(value as never)}, is_placeholder = true, updated_by = NULL
        WHERE key = ${key}`;
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
