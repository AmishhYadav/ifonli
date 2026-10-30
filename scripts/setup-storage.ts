/**
 * Creates / reconciles the Supabase Storage buckets (products, cutouts, content public; private).
 * Works against local Supabase (`supabase start`) or a hosted project, using SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY from .env.local. Idempotent.
 *
 *   pnpm storage:setup
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config();

async function main() {
  const { ensureBuckets, BUCKET_SPECS } = await import("../src/server/storage");
  const result = await ensureBuckets();
  console.log(`storage: created [${result.created.join(", ")}], updated [${result.updated.join(", ")}]`);
  for (const b of BUCKET_SPECS) {
    console.log(`  ${b.id.padEnd(8)} ${b.public ? "public " : "private"}  limit ${b.fileSizeLimit / 1024 / 1024} MB`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
