/**
 * Applies the store values (settings, vibe / product-type copy, policies, announcement bar) to the
 * database through the app's own admin services, so every write is validated, audited and clears
 * `is_placeholder`. Idempotent: re-running changes nothing once the values are in place.
 *
 *   pnpm exec tsx --conditions=react-server scripts/store-values/apply-settings-content.ts [--check] [--skip-policies] [--policy=<slug>[,<slug>]] [--allow-remote]
 *
 *   (no flag)  apply everything, then run the check
 *   --check    only run the check: launch checklist, policy rendering, FAQ visibility
 *   --skip-policies  leave published policies (versions, effective dates) untouched
 *   --policy=<slug>  apply and publish ONLY the named policies (repeat the flag or use a comma list,
 *              for example --policy=terms). Settings, vibe / type copy, the announcement bar and
 *              every other policy are left alone (their versions do not change), and the check
 *              covers only the named policies. For a named policy the content file
 *              content/policies/<slug>.md is the source of truth: a missing row is created from it, and
 *              a row whose title or text differs gets a new published version from the file. With
 *              --check it only checks them.
 *
 * Inputs: content/store-values/settings.json (registry key -> value, money in paise) and
 * content/store-values/collections.json. The actor is the owner staff account owner@ifonli.local.
 *
 * Next's cache tags cannot be expired from outside the Next process. The storefront caches content and
 * settings, so restart `next dev` (or wait for the cache lifetime) after running this.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { config } from "dotenv";

import { requireLocalOrAllowRemote } from "../db-guard";

config({ path: ".env.local" });
config();

const OWNER_EMAIL = "owner@ifonli.local";
const POLICY_EFFECTIVE_DATE = "2026-11-01"; // IST calendar date
const DRAFT_NOTICE = /^> \*\*Draft notice:\*\*[^\n]*\n(?:\n)?/m;

type Json = unknown;

async function readJson(file: string): Promise<Record<string, Json>> {
  return JSON.parse(await readFile(path.resolve(process.cwd(), file), "utf8")) as Record<
    string,
    Json
  >;
}

const log = (section: string, msg: string) => console.log(`[${section}] ${msg}`);

/** Slugs from `--policy=a,b` / repeated `--policy=a --policy=b`; null when the flag is absent. */
function policyFilter(argv: readonly string[]): string[] | null {
  const slugs = argv
    .filter((a) => a.startsWith("--policy="))
    .flatMap((a) => a.slice("--policy=".length).split(","))
    .map((x) => x.trim())
    .filter(Boolean);
  const present = argv.some((a) => a.startsWith("--policy="));
  if (!present) return null;
  if (slugs.length === 0) throw new Error("--policy needs at least one policy slug, e.g. --policy=terms");
  return [...new Set(slugs)];
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const only = policyFilter(process.argv);
  if (only) {
    const { POLICY_SLUGS } = await import("../../src/server/content/policies");
    const unknown = only.filter((slug) => !(POLICY_SLUGS as readonly string[]).includes(slug));
    if (unknown.length > 0) {
      throw new Error(`Unknown policy slug(s): ${unknown.join(", ")}. Known: ${POLICY_SLUGS.join(", ")}`);
    }
  }
  if (!checkOnly) {
    requireLocalOrAllowRemote(
      "apply-settings-content",
      "overwrite store settings, copy and policies",
    );
  }

  const { eq } = await import("drizzle-orm");
  const { getDb } = await import("../../src/server/db");
  const schema = await import("../../src/server/db/schema");
  const db = getDb();

  let failures = 0;

  if (!checkOnly) {
    const [owner] = await db
      .select({ id: schema.user.id, role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.email, OWNER_EMAIL))
      .limit(1);
    if (!owner) throw new Error(`Staff account ${OWNER_EMAIL} not found. Run pnpm db:seed first.`);
    const actor = { id: owner.id, role: owner.role, ip: null };

    if (only) {
      log("policies", `only: ${only.join(", ")} (settings, copy and announcement skipped)`);
      failures += await applyPolicies(db, schema, actor, only);
    } else {
      failures += await applySettings(db, schema, actor);
      failures += await applyCollections(db, schema, actor);
      if (process.argv.includes("--skip-policies")) log("policies", "skipped (--skip-policies)");
      else failures += await applyPolicies(db, schema, actor);
      failures += await applyAnnouncement(db, schema, actor);
    }
  }

  failures += await runCheck(db, schema, only);

  if (failures > 0) {
    console.error(`\n${failures} problem(s) found.`);
    process.exit(1);
  }
  console.log("\nDone.");
  process.exit(0);
}

type Db = ReturnType<typeof import("../../src/server/db").getDb>;
type Schema = typeof import("../../src/server/db/schema");
type Actor = { id: string; role: string; ip: null };

// ---------------------------------------------------------------------------------------------
// 1. Settings
// ---------------------------------------------------------------------------------------------
async function applySettings(db: Db, schema: Schema, actor: Actor): Promise<number> {
  const { SETTINGS, SETTING_KEYS, isSettingKey } =
    await import("../../src/server/services/settings-registry");
  const { updateSettingAdmin, SettingAdminValidationError } =
    await import("../../src/server/services/admin/settings");
  const values = await readJson("content/store-values/settings.json");
  const rows = await db.select().from(schema.settings);
  const byKey = new Map(rows.map((r) => [r.key, r]));

  let failures = 0;
  let written = 0;
  let unchanged = 0;
  for (const [key, raw] of Object.entries(values)) {
    if (key === "_note") continue;
    if (!isSettingKey(key)) {
      log("settings", `UNKNOWN key in settings.json: ${key}`);
      failures++;
      continue;
    }
    const def = SETTINGS[key];
    if ("locked" in def && def.locked) {
      log("settings", `skip locked: ${key}`);
      continue;
    }
    const parsed = def.schema.safeParse(raw);
    const existing = byKey.get(key);
    if (
      parsed.success &&
      existing &&
      !existing.isPlaceholder &&
      isDeepStrictEqual(existing.value, parsed.data)
    ) {
      unchanged++;
      continue;
    }
    try {
      await updateSettingAdmin(db, key, raw, actor);
      written++;
    } catch (error) {
      failures++;
      const detail =
        error instanceof SettingAdminValidationError
          ? error.issues.map((i) => `${i.path || "(value)"}: ${i.message}`).join("; ")
          : error instanceof Error
            ? error.message
            : String(error);
      log("settings", `FAILED ${key}: ${detail}`);
    }
  }
  log("settings", `${written} written, ${unchanged} already up to date`);

  // Every non-locked setting must now be real.
  const after = await db
    .select({ key: schema.settings.key, p: schema.settings.isPlaceholder })
    .from(schema.settings);
  const stillPlaceholder = SETTING_KEYS.filter((k) => {
    const def = SETTINGS[k];
    if ("locked" in def && def.locked) return false;
    const row = after.find((r) => r.key === k);
    return !row || row.p;
  });
  if (stillPlaceholder.length) {
    failures++;
    log("settings", `still placeholder (not in settings.json?): ${stillPlaceholder.join(", ")}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------
// 2. Vibe and product-type copy
// ---------------------------------------------------------------------------------------------
interface VibeCopy {
  name: string;
  description: string;
  heroCopy: string;
  seoTitle: string;
  seoDesc: string;
}
interface TypeCopy {
  name: string;
  definition: string;
  seoTitle: string;
  seoDesc: string;
}

async function applyCollections(db: Db, schema: Schema, actor: Actor): Promise<number> {
  const { updateVibeCopy, updateTypeCopy } =
    await import("../../src/server/services/admin/collections");
  const copy = (await readJson("content/store-values/collections.json")) as unknown as {
    vibes: Record<string, VibeCopy>;
    types: Record<string, TypeCopy>;
  };
  let failures = 0;
  let written = 0;
  let unchanged = 0;

  const vibeRows = await db.select().from(schema.vibes);
  for (const [slug, next] of Object.entries(copy.vibes)) {
    const row = vibeRows.find((v) => v.slug === slug);
    if (!row) {
      failures++;
      log("collections", `vibe not found: ${slug}`);
      continue;
    }
    if (
      row.name === next.name &&
      row.description === next.description &&
      row.heroCopy === next.heroCopy &&
      row.seoTitle === next.seoTitle &&
      row.seoDesc === next.seoDesc
    ) {
      unchanged++;
      continue;
    }
    try {
      await updateVibeCopy(db, row.id, next, actor);
      written++;
    } catch (error) {
      failures++;
      log(
        "collections",
        `FAILED vibe ${slug}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const typeRows = await db.select().from(schema.productTypes);
  for (const [slug, next] of Object.entries(copy.types)) {
    const row = typeRows.find((t) => t.slug === slug);
    if (!row) {
      failures++;
      log("collections", `type not found: ${slug}`);
      continue;
    }
    if (
      row.name === next.name &&
      row.definition === next.definition &&
      row.seoTitle === next.seoTitle &&
      row.seoDesc === next.seoDesc
    ) {
      unchanged++;
      continue;
    }
    try {
      await updateTypeCopy(db, row.id, { ...next, active: row.active }, actor);
      written++;
    } catch (error) {
      failures++;
      log(
        "collections",
        `FAILED type ${slug}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  log("collections", `${written} written, ${unchanged} already up to date`);
  return failures;
}

// ---------------------------------------------------------------------------------------------
// 4. Policies
// ---------------------------------------------------------------------------------------------
async function applyPolicies(
  db: Db,
  schema: Schema,
  actor: Actor,
  only: readonly string[] | null = null,
): Promise<number> {
  const { eq } = await import("drizzle-orm");
  const { savePolicyDraft, publishPolicy, istDateToInstant } =
    await import("../../src/server/services/admin/policies");
  const { POLICY_SLUGS } = await import("../../src/server/content/policies");
  const effective = istDateToInstant(POLICY_EFFECTIVE_DATE).getTime();
  let failures = 0;

  const fileFor = new Map<string, import("../../src/server/content/seed").PolicyFile>();
  if (only) {
    const { loadContentFiles } = await import("../../src/server/content/seed");
    const content = await loadContentFiles(path.resolve(process.cwd(), "content"));
    for (const f of content.policies) fileFor.set(f.slug, f);
    for (const slug of only) {
      if (!fileFor.has(slug)) throw new Error(`No content/policies/${slug}.md to publish`);
    }
  }

  for (const slug of only ?? POLICY_SLUGS) {
    try {
      let [row] = await db
        .select()
        .from(schema.policies)
        .where(eq(schema.policies.slug, slug))
        .limit(1);
      if (!row && only) {
        // A policy added after the database was first seeded: create it (as a draft) from its file.
        const { seedPolicies } = await import("../../src/server/content/seed");
        const file = fileFor.get(slug);
        if (file) {
          await seedPolicies(db, [{ ...file, draft: true }]);
          log("policies", `${slug}: created from content/policies/${slug}.md`);
          [row] = await db
            .select()
            .from(schema.policies)
            .where(eq(schema.policies.slug, slug))
            .limit(1);
        }
      }
      if (!row) {
        failures++;
        log("policies", `${slug}: no policy row. Run scripts/seed-content.ts first.`);
        continue;
      }
      // The seeded text starts with a "Draft notice" quote about legal review; drop it for the launch text.
      // Named with --policy: the content file is the source of truth (a row left over from an earlier
      // version of the file is replaced by a new published version). Otherwise keep the database text.
      const source = only ? fileFor.get(slug) : undefined;
      const title = source?.title ?? row.title;
      const bodyMd = (source?.bodyMd ?? row.bodyMd).replace(DRAFT_NOTICE, "");
      if (
        row.published &&
        row.bodyMd === bodyMd &&
        row.title === title &&
        row.effectiveAt?.getTime() === effective
      ) {
        log("policies", `${slug}: v${row.version} already published`);
        continue;
      }
      await savePolicyDraft(db, slug, { title, bodyMd }, actor);
      const { version } = await publishPolicy(
        db,
        slug,
        { effectiveDate: POLICY_EFFECTIVE_DATE },
        actor,
      );
      log("policies", `${slug}: published v${version}, effective ${POLICY_EFFECTIVE_DATE}`);
    } catch (error) {
      failures++;
      log("policies", `FAILED ${slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------
// 5. Announcement bar
// ---------------------------------------------------------------------------------------------
function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

async function applyAnnouncement(db: Db, schema: Schema, actor: Actor): Promise<number> {
  const { readSettings } = await import("../../src/server/services/queries/shared");
  const { listBanners, createBanner, updateBanner, setBannerActive } =
    await import("../../src/server/services/admin/banners");
  const s = await readSettings(db, ["free_threshold", "cod_enabled"] as const);
  const parts: string[] = [];
  if (s.free_threshold.value > 0)
    parts.push(`Free shipping on orders of ${rupees(s.free_threshold.value)} or more`);
  parts.push("MAHE Bengaluru campus: delivered in 24 hours");
  if (s.cod_enabled.value) parts.push("Cash on delivery available");
  if (parts.length === 0) {
    log("announcement", "nothing true to announce; left alone");
    return 0;
  }
  const title = parts.join(" · ");
  const desired = {
    placement: "announcement" as const,
    vibeId: null,
    title,
    body: null,
    imagePath: null,
    link: null,
    startsAt: null,
    endsAt: null,
    active: true,
  };

  try {
    const existing = await listBanners(db, { placement: "announcement" });
    // Keep one row: prefer a live one, then any active one, then the first.
    const keep =
      existing.find((b) => b.state === "live") ?? existing.find((b) => b.active) ?? existing[0];
    if (!keep) {
      await createBanner(db, desired, actor);
      log("announcement", `created: "${title}"`);
    } else {
      const same =
        keep.title === title &&
        keep.body === null &&
        keep.link === null &&
        keep.startsAt === null &&
        keep.endsAt === null &&
        keep.vibeId === null &&
        keep.active;
      if (same) log("announcement", "already up to date");
      else {
        await updateBanner(db, keep.id, desired, actor);
        log("announcement", `updated: "${title}"`);
      }
    }
    for (const other of existing) {
      if (other.id !== keep?.id && other.active) {
        await setBannerActive(db, other.id, false, actor);
        log("announcement", `deactivated extra announcement ${other.id}`);
      }
    }
    return 0;
  } catch (error) {
    log("announcement", `FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// ---------------------------------------------------------------------------------------------
// 6. Check
// ---------------------------------------------------------------------------------------------
async function checkPolicies(db: Db, slugs: readonly string[]): Promise<number> {
  const { loadPolicyPage } = await import("../../src/server/content/policies");
  let failures = 0;
  console.log("\n=== Policies (storefront renderer, production mode) ===");
  for (const slug of slugs) {
    const page = await loadPolicyPage(db, slug, { review: false });
    const bad =
      !page || page.withheld || page.draft || page.html.includes("{{") || page.problems.length > 0;
    console.log(
      `${bad ? "FAIL" : "OK  "} ${slug}: v${page?.version} effective ${page?.effectiveAt ? new Date(page.effectiveAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "-"} ${page ? `${page.html.length} chars html` : "missing"}`,
    );
    if (bad) failures++;
  }
  return failures;
}

async function runCheck(db: Db, schema: Schema, only: readonly string[] | null = null): Promise<number> {
  const { POLICY_SLUGS } = await import("../../src/server/content/policies");
  // --policy=<slug>: only the named policies are checked (nothing else was touched).
  if (only) return checkPolicies(db, only);
  const { getLaunchReadiness, LAUNCH_CATEGORY_LABELS } =
    await import("../../src/server/services/admin/launch");
  const { listBanners } = await import("../../src/server/services/admin/banners");
  const { SETTINGS, SETTING_KEYS } = await import("../../src/server/services/settings-registry");
  let failures = 0;

  console.log("\n=== Launch checklist ===");
  const readiness = await getLaunchReadiness(db);
  for (const item of readiness.items) {
    console.log(
      `${item.severity.toUpperCase().padEnd(7)} ${item.category.padEnd(11)} ${item.title}${item.detail ? `  (${item.detail})` : ""}`,
    );
  }
  for (const c of readiness.categories) {
    console.log(
      `  ${LAUNCH_CATEGORY_LABELS[c.id]}: ${c.blockers} blockers, ${c.warnings} warnings`,
    );
  }
  // Settings, policies and content are ours; products and environment are not.
  const mine = readiness.items.filter(
    (i) =>
      (i.category === "settings" || i.category === "policies" || i.category === "content") &&
      i.severity === "blocker",
  );
  const faqHidden = readiness.items.filter((i) => i.id === "content:faq-hidden");
  if (mine.length || faqHidden.length) {
    failures++;
    console.log(
      `\nFAIL: ${mine.length} settings/policies/content blockers, ${faqHidden.length} hidden-FAQ warnings`,
    );
  }

  console.log("\n=== Settings ===");
  const rows = await db.select().from(schema.settings);
  const leftover = SETTING_KEYS.filter((k) => {
    const def = SETTINGS[k];
    if ("locked" in def && def.locked) return false;
    return rows.find((r) => r.key === k)?.isPlaceholder !== false;
  });
  console.log(
    leftover.length
      ? `FAIL placeholder settings left: ${leftover.join(", ")}`
      : "OK: no non-locked placeholder settings",
  );
  if (leftover.length) failures++;

  failures += await checkPolicies(db, POLICY_SLUGS);

  console.log("\n=== Announcement bar ===");
  const live = (await listBanners(db, { placement: "announcement" })).filter(
    (b) => b.state === "live",
  );
  console.log(
    `${live.length === 1 ? "OK  " : "FAIL"} ${live.length} live: ${live.map((b) => `"${b.title}"`).join(" | ")}`,
  );
  if (live.length !== 1) failures++;

  console.log("\n=== Copy ===");
  const copyRows = [
    ...(await db
      .select({ s: schema.vibes.slug, a: schema.vibes.description, b: schema.vibes.heroCopy })
      .from(schema.vibes)),
    ...(await db
      .select({
        s: schema.productTypes.slug,
        a: schema.productTypes.definition,
        b: schema.productTypes.seoDesc,
      })
      .from(schema.productTypes)),
  ];
  const bad = copyRows.filter((r) => /PLACEHOLDER/i.test(`${r.a} ${r.b}`) || !r.a);
  console.log(
    bad.length
      ? `FAIL placeholder copy: ${bad.map((r) => r.s).join(", ")}`
      : "OK: no placeholder vibe / type copy",
  );
  if (bad.length) failures++;
  return failures;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
