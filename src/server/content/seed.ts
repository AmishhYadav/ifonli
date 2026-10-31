import "server-only";

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { faqs, policies, policyVersions } from "@/server/db/schema";
import type { DbClient } from "@/server/services/queries/shared";

import { parseFrontMatter } from "./front-matter";

/**
 * Loads `content/policies/*.md` and `content/faq.json` into the database (scripts/seed-content.ts).
 *
 * Idempotent and owner-safe:
 *  - a policy still unpublished (a draft) is refreshed from its file, so reviewing the copy in git keeps
 *    working; a published one is never touched (the owner/lawyer may have edited it in the admin);
 *  - FAQs are matched on (category, question) and left alone once they exist;
 *  - `force` overwrites both.
 * A policy is published only when its file status no longer starts with DRAFT.
 */

export interface PolicyFile {
  slug: string;
  title: string;
  /** Integer stored in `policies.version`: the major number of the file's version label (min 1). */
  version: number;
  versionLabel: string;
  status: string;
  lastReviewed: string | null;
  bodyMd: string;
  draft: boolean;
}

export function parsePolicyFile(source: string, fileName = "policy"): PolicyFile {
  const { data, body } = parseFrontMatter(source);
  const text = (key: string): string => {
    const value = data[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${fileName}: front matter "${key}" is required`);
    }
    return value.trim();
  };
  const slug = text("slug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`${fileName}: invalid slug "${slug}"`);
  const rawVersion = data.version;
  const versionLabel = String(rawVersion ?? "").trim();
  if (!versionLabel) throw new Error(`${fileName}: front matter "version" is required`);
  const major = /^(\d+)/.exec(versionLabel);
  const reviewed = data.lastReviewed;
  if (reviewed !== null && reviewed !== undefined && !(typeof reviewed === "string" && !Number.isNaN(Date.parse(reviewed)))) {
    throw new Error(`${fileName}: "lastReviewed" must be null or a date`);
  }
  const status = text("status");
  return {
    slug,
    title: text("title"),
    version: Math.max(1, major ? Number(major[1]) : 1),
    versionLabel,
    status,
    lastReviewed: typeof reviewed === "string" ? reviewed : null,
    bodyMd: body.trimEnd() + "\n",
    draft: /^draft/i.test(status),
  };
}

const faqSchema = z.array(
  z.object({
    category: z.enum(["delivery", "payment", "product", "orders"]),
    question: z.string().trim().min(1),
    answerMd: z.string().trim().min(1),
    position: z.number().int().min(0),
  }),
);
export type FaqSeed = z.infer<typeof faqSchema>[number];

export function parseFaqFile(json: string): FaqSeed[] {
  return faqSchema.parse(JSON.parse(json));
}

export async function loadContentFiles(
  dir: string,
): Promise<{ policies: PolicyFile[]; faqs: FaqSeed[] }> {
  const policyDir = path.join(dir, "policies");
  const names = (await readdir(policyDir)).filter((n) => n.endsWith(".md")).sort();
  const files = await Promise.all(
    names.map(async (name) => parsePolicyFile(await readFile(path.join(policyDir, name), "utf8"), name)),
  );
  const slugs = new Set<string>();
  for (const f of files) {
    if (slugs.has(f.slug)) throw new Error(`Duplicate policy slug "${f.slug}"`);
    slugs.add(f.slug);
  }
  return { policies: files, faqs: parseFaqFile(await readFile(path.join(dir, "faq.json"), "utf8")) };
}

export interface SeedCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

export async function seedPolicies(
  db: DbClient,
  files: readonly PolicyFile[],
  opts: { force?: boolean } = {},
): Promise<SeedCounts> {
  const counts: SeedCounts = { inserted: 0, updated: 0, unchanged: 0 };
  for (const file of files) {
    await db.transaction(async (tx) => {
      const effectiveAt = file.lastReviewed ? new Date(file.lastReviewed) : null;
      const fields = {
        title: file.title,
        bodyMd: file.bodyMd,
        version: file.version,
        effectiveAt,
        published: !file.draft,
      };
      const [existing] = await tx.select().from(policies).where(eq(policies.slug, file.slug)).limit(1);

      let policyId: string;
      if (!existing) {
        const [row] = await tx.insert(policies).values({ slug: file.slug, ...fields }).returning({ id: policies.id });
        policyId = (row as { id: string }).id;
        counts.inserted++;
      } else {
        policyId = existing.id;
        const refresh = opts.force === true || !existing.published;
        const same =
          existing.title === fields.title &&
          existing.bodyMd === fields.bodyMd &&
          existing.version === fields.version &&
          existing.published === fields.published &&
          (existing.effectiveAt?.getTime() ?? null) === (effectiveAt?.getTime() ?? null);
        if (!refresh || same) {
          counts.unchanged++;
        } else {
          await tx.update(policies).set(fields).where(eq(policies.id, policyId));
          counts.updated++;
        }
        if (!refresh) return;
      }

      // History row for this version. A draft version is still file-owned, so it follows the file.
      const versionFields = { title: file.title, bodyMd: file.bodyMd, effectiveAt };
      const [versionRow] = await tx
        .select({ id: policyVersions.id })
        .from(policyVersions)
        .where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.version, file.version)))
        .limit(1);
      if (!versionRow) {
        await tx.insert(policyVersions).values({ policyId, version: file.version, ...versionFields });
      } else if (file.draft || opts.force) {
        await tx.update(policyVersions).set(versionFields).where(eq(policyVersions.id, versionRow.id));
      }
    });
  }
  return counts;
}

export async function seedFaqs(
  db: DbClient,
  items: readonly FaqSeed[],
  opts: { force?: boolean } = {},
): Promise<SeedCounts> {
  const counts: SeedCounts = { inserted: 0, updated: 0, unchanged: 0 };
  for (const item of items) {
    const [existing] = await db
      .select()
      .from(faqs)
      .where(and(eq(faqs.category, item.category), eq(faqs.question, item.question)))
      .limit(1);
    if (!existing) {
      await db.insert(faqs).values({ ...item, published: true });
      counts.inserted++;
    } else if (opts.force && (existing.answerMd !== item.answerMd || existing.position !== item.position)) {
      await db
        .update(faqs)
        .set({ answerMd: item.answerMd, position: item.position })
        .where(eq(faqs.id, existing.id));
      counts.updated++;
    } else {
      counts.unchanged++;
    }
  }
  return counts;
}
