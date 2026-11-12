#!/usr/bin/env node
/**
 * Runs `drizzle-kit migrate` before `next build` on Vercel production builds (wired as `vercel-build`).
 *
 * - Only when VERCEL_ENV=production: preview builds have no database variables and must never touch prod.
 * - Uses DATABASE_URL (the Supabase session pooler, port 5432), which is known to be reachable from Vercel;
 *   falls back to DIRECT_URL. Migrations are idempotent: already-applied ones are skipped.
 * - Any failure exits non-zero, so the build fails and the previous deployment stays live.
 */
import { spawnSync } from "node:child_process";

const env = process.env.VERCEL_ENV;
if (env !== "production") {
  console.log(`[migrate-on-deploy] VERCEL_ENV=${env ?? "unset"}: skipping migrations.`);
  process.exit(0);
}

const url = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!url) {
  console.error("[migrate-on-deploy] Production build without DATABASE_URL or DIRECT_URL: cannot migrate.");
  process.exit(1);
}

console.log("[migrate-on-deploy] Applying pending migrations…");
const result = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
  stdio: "inherit",
  // drizzle.config.ts reads DIRECT_URL first; point it at the URL chosen above.
  env: { ...process.env, DIRECT_URL: url },
});
if (result.status !== 0) {
  console.error("[migrate-on-deploy] Migration failed: stopping the build so the live deployment stays as it is.");
  process.exit(result.status ?? 1);
}
console.log("[migrate-on-deploy] Migrations up to date.");
