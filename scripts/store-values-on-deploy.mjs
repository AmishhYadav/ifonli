#!/usr/bin/env node
/**
 * Applies content/store-values and content/policies to the production database on Vercel production builds
 * (wired as `vercel-build`, after migrate-on-deploy.mjs and before `next build`, so the new build renders the new data).
 *
 * - Only when VERCEL_ENV=production, like migrate-on-deploy.mjs.
 * - Each piece is applied only when its source files changed since it was last applied (hashes in the
 *   store_values_applied table, migration 0010). Admin edits survive every deploy that does not touch that piece.
 *     settings   content/store-values/settings.json + collections.json -> apply-settings-content.ts --skip-policies
 *     policy:<slug>  content/policies/<slug>.md                        -> apply-settings-content.ts --policy=<slug>
 *     catalogue  content/store-values/catalogue.json + public/products/ -> apply-catalogue.ts (replaces every product)
 *   The script that applies a piece is part of its hash, so a fix to a script re-runs it once.
 * - Any failure exits non-zero, so the build fails and the previous deployment stays live.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

const env = process.env.VERCEL_ENV;
if (env !== "production") {
  console.log(`[store-values-on-deploy] VERCEL_ENV=${env ?? "unset"}: skipping.`);
  process.exit(0);
}

const url = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!url) {
  console.error("[store-values-on-deploy] Production build without DATABASE_URL or DIRECT_URL.");
  process.exit(1);
}

const SETTINGS_SCRIPT = "scripts/store-values/apply-settings-content.ts";
const CATALOGUE_SCRIPT = "scripts/store-values/apply-catalogue.ts";

function hashFiles(files) {
  const h = createHash("sha256");
  for (const f of [...files].sort()) h.update(f).update("\0").update(readFileSync(f)).update("\0");
  return h.digest("hex");
}

const listDir = (dir) => readdirSync(dir).map((f) => path.join(dir, f));

const policyFiles = listDir("content/policies").filter((f) => f.endsWith(".md"));
const pieces = [
  {
    key: "settings",
    files: [
      "content/store-values/settings.json",
      "content/store-values/collections.json",
      SETTINGS_SCRIPT,
    ],
    args: [SETTINGS_SCRIPT, "--skip-policies"],
  },
  ...policyFiles.map((f) => {
    const slug = path.basename(f, ".md");
    return { key: `policy:${slug}`, files: [f], args: [SETTINGS_SCRIPT, `--policy=${slug}`] };
  }),
  {
    key: "catalogue",
    files: ["content/store-values/catalogue.json", CATALOGUE_SCRIPT, ...listDir("public/products")],
    args: [CATALOGUE_SCRIPT],
  },
];

const sql = postgres(url, { max: 1, prepare: false });
let status = 0;
try {
  const rows = await sql`SELECT "key", "hash" FROM "store_values_applied"`;
  const applied = new Map(rows.map((r) => [r.key, r.hash]));

  for (const piece of pieces) {
    const hash = hashFiles(piece.files);
    if (applied.get(piece.key) === hash) {
      console.log(`[store-values-on-deploy] ${piece.key}: unchanged.`);
      continue;
    }
    console.log(`[store-values-on-deploy] ${piece.key}: applying…`);
    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", "--conditions=react-server", ...piece.args, "--allow-remote"],
      { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } },
    );
    if (result.status !== 0) {
      console.error(
        `[store-values-on-deploy] ${piece.key} failed: stopping the build so the live deployment stays as it is.`,
      );
      status = result.status ?? 1;
      break;
    }
    await sql`
      INSERT INTO "store_values_applied" ("key", "hash") VALUES (${piece.key}, ${hash})
      ON CONFLICT ("key") DO UPDATE SET "hash" = EXCLUDED."hash", "applied_at" = now()
    `;
  }
} finally {
  await sql.end();
}
if (status === 0) console.log("[store-values-on-deploy] Store values up to date.");
process.exit(status);
