import "server-only";

import { asc, eq } from "drizzle-orm";

import { faqs, policies } from "@/server/db/schema";
import { FAQ_CATEGORY_ORDER, type FaqCategory } from "@/server/services/content";
import { readSettings, type DbClient } from "@/server/services/queries/shared";
import { SETTING_KEYS } from "@/server/services/settings-registry";

import { buildTemplateContext } from "./context";
import { htmlToText } from "./markdown";
import { prepareContent, type PreparedContent, type WithheldReason } from "./publish";
import type { TemplateContext } from "./render-template";

/** Policy slugs and titles in footer order. The `/policies/[slug]` route prerenders exactly these. */
export const POLICY_SLUGS = [
  "shipping",
  "cancellation",
  "returns-refunds",
  "privacy",
  "terms",
  "seller-information",
] as const;
export type PolicySlug = (typeof POLICY_SLUGS)[number];

export function isPolicySlug(slug: string): slug is PolicySlug {
  return (POLICY_SLUGS as readonly string[]).includes(slug);
}

/** Every setting as a template context (one query). */
export async function loadTemplateContext(db: DbClient): Promise<TemplateContext> {
  const readings = await readSettings(db, SETTING_KEYS);
  return buildTemplateContext(
    SETTING_KEYS.map((key) => ({
      key,
      value: readings[key].value,
      isPlaceholder: readings[key].isPlaceholder,
    })),
  );
}

/** Plain, serialisable page model (safe to return from a `'use cache'` function). */
export interface PolicyPage {
  slug: string;
  title: string;
  version: number;
  /** ISO date, or null while the policy has no effective date (drafts). */
  effectiveAt: string | null;
  html: string;
  headings: PreparedContent["headings"];
  published: boolean;
  /** Not final (unpublished or unresolved tokens). Only true in review mode; production withholds the body. */
  draft: boolean;
  withheld: WithheldReason | null;
  problems: { kind: string; token: string; message: string }[];
}

/**
 * The policy as the storefront should show it, or null for an unknown slug. The `policies` row is the
 * current version (draft or published); `review` decides whether an unfinished one is shown.
 */
export async function loadPolicyPage(
  db: DbClient,
  slug: string,
  opts: { review: boolean },
): Promise<PolicyPage | null> {
  const [row] = await db.select().from(policies).where(eq(policies.slug, slug)).limit(1);
  if (!row) return null;
  const ctx = await loadTemplateContext(db);
  const prepared = prepareContent({
    bodyMd: row.bodyMd,
    published: row.published,
    ctx,
    review: opts.review,
    dropTitle: true,
  });
  return {
    slug: row.slug,
    title: row.title,
    version: row.version,
    effectiveAt: row.effectiveAt ? row.effectiveAt.toISOString() : null,
    html: prepared.html,
    headings: prepared.headings,
    published: row.published,
    draft: prepared.draft,
    withheld: prepared.withheld,
    problems: prepared.problems,
  };
}

/** Title and visibility of each known policy for the `/policies` index. */
export async function loadPolicyIndex(
  db: DbClient,
  opts: { review: boolean },
): Promise<{ slug: string; title: string; published: boolean }[]> {
  const rows = await db
    .select({ slug: policies.slug, title: policies.title, published: policies.published })
    .from(policies)
    .orderBy(asc(policies.title));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return POLICY_SLUGS.flatMap((slug) => {
    const row = bySlug.get(slug);
    if (!row) return [];
    return opts.review || row.published ? [row] : [];
  });
}

export interface HelpFaq {
  id: string;
  question: string;
  html: string;
  /** Tag-free answer for FAQPage JSON-LD. */
  text: string;
  draft: boolean;
}
export interface HelpFaqGroup {
  category: FaqCategory;
  items: HelpFaq[];
}

/**
 * Published FAQs, answers rendered through the template engine, grouped in the fixed category order.
 * In production an answer with unresolved or placeholder tokens is left out; in review mode it is shown
 * with markers.
 */
export async function loadHelpFaqs(db: DbClient, opts: { review: boolean }): Promise<HelpFaqGroup[]> {
  const [rows, ctx] = await Promise.all([
    db
      .select()
      .from(faqs)
      .where(eq(faqs.published, true))
      .orderBy(asc(faqs.position), asc(faqs.createdAt), asc(faqs.id)),
    loadTemplateContext(db),
  ]);
  return FAQ_CATEGORY_ORDER.map((category) => ({
    category,
    items: rows
      .filter((r) => r.category === category)
      .flatMap((r) => {
        const prepared = prepareContent({
          bodyMd: r.answerMd,
          published: true,
          ctx,
          review: opts.review,
        });
        if (prepared.withheld) return [];
        return [
          {
            id: r.id,
            question: r.question,
            html: prepared.html,
            text: htmlToText(prepared.html),
            draft: prepared.draft,
          },
        ];
      }),
  })).filter((g) => g.items.length > 0);
}
