/**
 * Idempotent content seed: policies (content/policies/*.md -> `policies` + `policy_versions`) and FAQs
 * (content/faq.json -> `faqs`). Policies stay unpublished while their status starts with DRAFT.
 * Re-running refreshes still-unpublished policies from the files and leaves published policies and
 * existing FAQs alone; pass --force to overwrite those too.
 *
 *   pnpm exec tsx --conditions=react-server scripts/seed-content.ts [--force]
 */
import path from "node:path";

import { config } from "dotenv";

config({ path: ".env.local" });
config();

async function main() {
  const { getDb } = await import("../src/server/db");
  const { loadContentFiles, seedFaqs, seedPolicies } = await import("../src/server/content/seed");
  const force = process.argv.includes("--force");
  const db = getDb();

  const content = await loadContentFiles(path.resolve(process.cwd(), "content"));
  const p = await seedPolicies(db, content.policies, { force });
  const f = await seedFaqs(db, content.faqs, { force });

  const drafts = content.policies.filter((x) => x.draft).length;
  console.log(
    `Policies: ${p.inserted} inserted, ${p.updated} updated, ${p.unchanged} unchanged (${drafts}/${content.policies.length} still DRAFT, kept unpublished).`,
  );
  console.log(`FAQs: ${f.inserted} inserted, ${f.updated} updated, ${f.unchanged} unchanged.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
