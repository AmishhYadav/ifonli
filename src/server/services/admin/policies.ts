import "server-only";

import { and, asc, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { assertCan } from "@/server/auth/permissions";
import { renderMarkdown } from "@/server/content/markdown";
import { POLICY_SLUGS, isPolicySlug, loadTemplateContext, type PolicySlug } from "@/server/content/policies";
import { renderTemplate, type TemplateProblem } from "@/server/content/render-template";
import { policies, policyVersions, user } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import type { DbClient } from "@/server/services/queries/shared";

import { AdminInputError, type AdminActor } from "./products";

/**
 * Versioned policies.
 *
 * Model (no schema change): `policies` holds the current row and `policy_versions` the history.
 *  - A published policy at version N is live from `policies`. Editing it writes a DRAFT as the
 *    `policy_versions` row N+1 (`published_by` NULL); the live text is untouched until publish.
 *  - A policy never published yet (`published = false`, e.g. seeded from `content/`) IS its own draft:
 *    the `policies` row and the `policy_versions` row at the same version are edited together.
 *  - Publishing (owner only, `policy:publish`) copies the draft into `policies`, stamps the version row
 *    with the publisher and effective date, and is refused while the draft has unresolved or
 *    placeholder settings tokens (the same rule the storefront applies in production).
 * A version is history when `version <= live version` (published) or `version < live version` (draft policy).
 */

export const POLICY_TITLES: Record<PolicySlug, string> = {
  shipping: "Shipping policy",
  cancellation: "Cancellation policy",
  "returns-refunds": "Returns and refunds policy",
  privacy: "Privacy notice",
  terms: "Terms of use",
  grievance: "Grievance redressal",
  "seller-information": "Seller information",
};

export class PolicyPublishBlockedError extends AdminInputError {
  constructor(readonly problems: TemplateProblem[]) {
    super(
      `This policy cannot be published yet: ${problems.length} token ${problems.length === 1 ? "problem" : "problems"} to fix`,
    );
    this.name = "PolicyPublishBlockedError";
  }
}

export const policyDraftSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(150),
  bodyMd: z.string().max(100_000, "That is too long").refine((v) => v.trim().length > 0, "The policy text is empty"),
});

/** A `YYYY-MM-DD` date in IST, today or earlier. */
export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}
const effectiveDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an effective date")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00+05:30`)), "Not a valid date");

/** Midnight IST of an IST calendar date. */
export function istDateToInstant(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

export interface PolicyListRow {
  slug: PolicySlug;
  title: string;
  exists: boolean;
  published: boolean;
  /** Live version (or the draft's version while never published). */
  version: number | null;
  effectiveAt: Date | null;
  /** A saved draft that differs from the live text (or a never-published policy with text). */
  hasDraft: boolean;
  updatedAt: Date | null;
}

export async function listPoliciesAdmin(db: DbClient): Promise<PolicyListRow[]> {
  const [rows, drafts] = await Promise.all([
    db.select().from(policies),
    db
      .select({ policyId: policyVersions.policyId, version: policyVersions.version })
      .from(policyVersions),
  ]);
  return POLICY_SLUGS.map((slug) => {
    const row = rows.find((r) => r.slug === slug);
    if (!row) {
      return {
        slug,
        title: POLICY_TITLES[slug],
        exists: false,
        published: false,
        version: null,
        effectiveAt: null,
        hasDraft: false,
        updatedAt: null,
      };
    }
    const pendingVersion = drafts.some((d) => d.policyId === row.id && d.version > row.version);
    return {
      slug,
      title: row.title,
      exists: true,
      published: row.published,
      version: row.version,
      effectiveAt: row.effectiveAt,
      hasDraft: row.published ? pendingVersion : true,
      updatedAt: row.updatedAt,
    };
  });
}

export interface PolicyVersionRow {
  version: number;
  title: string;
  bodyMd: string;
  effectiveAt: Date | null;
  publishedByName: string | null;
  isLive: boolean;
}

export interface PolicyEditorData {
  slug: PolicySlug;
  exists: boolean;
  published: boolean;
  liveVersion: number | null;
  live: { title: string; bodyMd: string; effectiveAt: Date | null } | null;
  /** The text being edited: the saved draft, else a copy of the live text. */
  draft: { title: string; bodyMd: string; version: number; saved: boolean };
  /** Token problems in the draft right now (empty = publishable, ignoring other checks). */
  problems: TemplateProblem[];
  history: PolicyVersionRow[];
}

/** Version number the next publish will have. */
export function draftVersionOf(policy: { published: boolean; version: number }): number {
  return policy.published ? policy.version + 1 : policy.version;
}

export async function getPolicyEditor(db: DbClient, slug: string): Promise<PolicyEditorData | null> {
  if (!isPolicySlug(slug)) return null;
  const [row] = await db.select().from(policies).where(eq(policies.slug, slug)).limit(1);
  const ctx = await loadTemplateContext(db);
  if (!row) {
    return {
      slug,
      exists: false,
      published: false,
      liveVersion: null,
      live: null,
      draft: { title: POLICY_TITLES[slug], bodyMd: "", version: 1, saved: false },
      problems: [],
      history: [],
    };
  }
  const versions = await db
    .select({
      version: policyVersions.version,
      title: policyVersions.title,
      bodyMd: policyVersions.bodyMd,
      effectiveAt: policyVersions.effectiveAt,
      publishedBy: policyVersions.publishedBy,
      publisherName: user.name,
    })
    .from(policyVersions)
    .leftJoin(user, eq(policyVersions.publishedBy, user.id))
    .where(eq(policyVersions.policyId, row.id))
    .orderBy(desc(policyVersions.version));

  const draftVersion = draftVersionOf(row);
  const savedDraft = versions.find((v) => v.version === draftVersion);
  const draft = savedDraft
    ? { title: savedDraft.title, bodyMd: savedDraft.bodyMd, version: draftVersion, saved: true }
    : // A published policy with no pending draft: start from the live text.
      row.published
      ? { title: row.title, bodyMd: row.bodyMd, version: draftVersion, saved: false }
      : { title: row.title, bodyMd: row.bodyMd, version: draftVersion, saved: true };
  const history = versions
    .filter((v) => (row.published ? v.version <= row.version : v.version < row.version))
    .map((v) => ({
      version: v.version,
      title: v.title,
      bodyMd: v.bodyMd,
      effectiveAt: v.effectiveAt,
      publishedByName: v.publisherName,
      isLive: row.published && v.version === row.version,
    }));
  return {
    slug,
    exists: true,
    published: row.published,
    liveVersion: row.published ? row.version : null,
    live: row.published ? { title: row.title, bodyMd: row.bodyMd, effectiveAt: row.effectiveAt } : null,
    draft,
    problems: renderTemplate(draft.bodyMd, ctx).problems,
    history,
  };
}

/** Token problems of a Markdown body against the current settings. */
export async function checkPolicyBody(db: DbClient, bodyMd: string): Promise<TemplateProblem[]> {
  return renderTemplate(bodyMd, await loadTemplateContext(db)).problems;
}

export interface PolicyPreview {
  html: string;
  problems: TemplateProblem[];
}

/** Editor preview: tokens filled from settings, problem spots marked (`<mark>`), through the safe renderer. */
export async function previewPolicyBody(db: DbClient, bodyMd: string): Promise<PolicyPreview> {
  const ctx = await loadTemplateContext(db);
  const { text, problems } = renderTemplate(bodyMd.slice(0, 100_000), ctx, { preview: true });
  return { html: renderMarkdown(text).html, problems };
}

/**
 * Saves the draft text. For a policy never published yet this edits the policy itself (plus its version
 * row); for a published one it writes the next version's draft row, leaving the live text alone.
 */
export async function savePolicyDraft(
  db: DbClient,
  slug: string,
  raw: unknown,
  actor: AdminActor,
): Promise<{ version: number }> {
  assertCan(actor.role, "policy:edit");
  if (!isPolicySlug(slug)) throw new AdminInputError("Unknown policy");
  const input = policyDraftSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(policies).where(eq(policies.slug, slug)).for("update");
    let policyId: string;
    let version: number;
    let before: { title: string; bodyMd: string } | null = null;
    if (!row) {
      const [created] = await tx
        .insert(policies)
        .values({ slug, title: input.title, bodyMd: input.bodyMd, version: 1, published: false })
        .returning({ id: policies.id });
      policyId = created!.id;
      version = 1;
    } else {
      policyId = row.id;
      version = draftVersionOf(row);
      if (!row.published) {
        before = { title: row.title, bodyMd: row.bodyMd };
        await tx.update(policies).set({ title: input.title, bodyMd: input.bodyMd }).where(eq(policies.id, policyId));
      }
    }
    const [existingVersion] = await tx
      .select()
      .from(policyVersions)
      .where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.version, version)));
    if (existingVersion) {
      before ??= { title: existingVersion.title, bodyMd: existingVersion.bodyMd };
      await tx
        .update(policyVersions)
        .set({ title: input.title, bodyMd: input.bodyMd })
        .where(eq(policyVersions.id, existingVersion.id));
    } else {
      await tx.insert(policyVersions).values({ policyId, version, title: input.title, bodyMd: input.bodyMd });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "policy.save_draft",
      entity: "policy",
      entityId: slug,
      diff: {
        version,
        title: before && before.title !== input.title ? { from: before.title, to: input.title } : undefined,
        bodyChars: { from: before?.bodyMd.length ?? 0, to: input.bodyMd.length },
      },
      ip: actor.ip,
    });
    return { version };
  });
}

/** Copies an earlier version's text into the draft (the draft is overwritten). */
export async function restorePolicyVersion(
  db: DbClient,
  slug: string,
  version: number,
  actor: AdminActor,
): Promise<{ version: number }> {
  assertCan(actor.role, "policy:edit");
  if (!isPolicySlug(slug)) throw new AdminInputError("Unknown policy");
  const [row] = await db.select().from(policies).where(eq(policies.slug, slug)).limit(1);
  if (!row) throw new AdminInputError("Policy not found");
  const [old] = await db
    .select()
    .from(policyVersions)
    .where(and(eq(policyVersions.policyId, row.id), eq(policyVersions.version, version)));
  const isHistory = row.published ? version <= row.version : version < row.version;
  if (!old || !isHistory) throw new AdminInputError("That version is not in the history");
  return savePolicyDraft(db, slug, { title: old.title, bodyMd: old.bodyMd }, actor);
}

/**
 * Publishes the draft (owner only). Refused when the text is empty, nothing changed since the live
 * version, the effective date is in the future, or the draft has unresolved / placeholder tokens.
 */
export async function publishPolicy(
  db: DbClient,
  slug: string,
  raw: unknown,
  actor: AdminActor,
  opts: { now?: Date } = {},
): Promise<{ version: number }> {
  assertCan(actor.role, "policy:publish");
  if (!isPolicySlug(slug)) throw new AdminInputError("Unknown policy");
  const now = opts.now ?? new Date();
  const input = z.object({ effectiveDate: effectiveDateSchema }).parse(raw);
  if (input.effectiveDate > istToday(now)) {
    throw new AdminInputError(
      "The effective date cannot be in the future: publishing makes the text live straight away",
    );
  }
  const ctx = await loadTemplateContext(db);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(policies).where(eq(policies.slug, slug)).for("update");
    if (!row) throw new AdminInputError("Save a draft first");
    const version = draftVersionOf(row);
    const [draft] = await tx
      .select()
      .from(policyVersions)
      .where(and(eq(policyVersions.policyId, row.id), eq(policyVersions.version, version)));
    const source = draft ?? (row.published ? null : { title: row.title, bodyMd: row.bodyMd });
    if (!source) throw new AdminInputError("There is no draft to publish");
    if (!source.bodyMd.trim()) throw new AdminInputError("The policy text is empty");
    if (row.published && source.title === row.title && source.bodyMd === row.bodyMd) {
      throw new AdminInputError("The draft is identical to the published version");
    }
    const { problems } = renderTemplate(source.bodyMd, ctx);
    if (problems.length > 0) throw new PolicyPublishBlockedError(problems);

    const effectiveAt = istDateToInstant(input.effectiveDate);
    await tx
      .update(policies)
      .set({
        title: source.title,
        bodyMd: source.bodyMd,
        version,
        effectiveAt,
        published: true,
      })
      .where(eq(policies.id, row.id));
    const stamp = { title: source.title, bodyMd: source.bodyMd, effectiveAt, publishedBy: actor.id };
    if (draft) {
      await tx.update(policyVersions).set(stamp).where(eq(policyVersions.id, draft.id));
    } else {
      await tx.insert(policyVersions).values({ policyId: row.id, version, ...stamp });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "policy.publish",
      entity: "policy",
      entityId: slug,
      diff: {
        version: { from: row.published ? row.version : null, to: version },
        effectiveDate: input.effectiveDate,
        bodyChars: { from: row.published ? row.bodyMd.length : 0, to: source.bodyMd.length },
      },
      ip: actor.ip,
    });
    return { version };
  });
}

/** Slugs whose text changed since the policy was last published (for the dashboard / gate). */
export async function policiesWithPendingDraft(db: DbClient): Promise<string[]> {
  const rows = await db
    .select({ slug: policies.slug })
    .from(policies)
    .innerJoin(policyVersions, eq(policyVersions.policyId, policies.id))
    .where(and(eq(policies.published, true), gt(policyVersions.version, policies.version)))
    .orderBy(asc(policies.slug));
  return rows.map((r) => r.slug);
}
