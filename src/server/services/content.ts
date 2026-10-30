import "server-only";

import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";

import { banners, faqs, policies, policyVersions, vibes } from "@/server/db/schema";

import type { DbClient } from "./queries/shared";

export type BannerPlacement = (typeof banners.$inferSelect)["placement"];
export type FaqCategory = (typeof faqs.$inferSelect)["category"];

/** Order the help page shows FAQ categories in. */
export const FAQ_CATEGORY_ORDER: readonly FaqCategory[] = [
  "delivery",
  "payment",
  "product",
  "orders",
];

export interface ActiveBanner {
  id: string;
  placement: BannerPlacement;
  /** null = global (shown in every vibe). */
  vibeSlug: string | null;
  title: string;
  body: string | null;
  imagePath: string | null;
  link: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  position: number;
}

/**
 * Banners live at `now`: `active`, and `starts_at <= now < ends_at` (either bound may be NULL).
 * With `vibe`, that vibe's banners plus the global ones; without it, only global banners.
 * Ordered by `position`, vibe-specific before global on ties, then newest first.
 */
export async function getActiveBanners(
  db: DbClient,
  opts: { placement: BannerPlacement; vibe?: string; now: Date },
): Promise<ActiveBanner[]> {
  const { placement, vibe, now } = opts;
  const rows = await db
    .select({
      id: banners.id,
      placement: banners.placement,
      vibeSlug: vibes.slug,
      title: banners.title,
      body: banners.body,
      imagePath: banners.imagePath,
      link: banners.link,
      startsAt: banners.startsAt,
      endsAt: banners.endsAt,
      position: banners.position,
      createdAt: banners.createdAt,
    })
    .from(banners)
    .leftJoin(vibes, eq(banners.vibeId, vibes.id))
    .where(
      and(
        eq(banners.placement, placement),
        eq(banners.active, true),
        or(isNull(banners.startsAt), lte(banners.startsAt, now)),
        or(isNull(banners.endsAt), gt(banners.endsAt, now)),
        vibe ? or(isNull(banners.vibeId), eq(vibes.slug, vibe)) : isNull(banners.vibeId),
      ),
    )
    .orderBy(asc(banners.position), desc(banners.createdAt), asc(banners.id));
  return rows
    .sort(
      (a, b) =>
        a.position - b.position ||
        Number(b.vibeSlug !== null) - Number(a.vibeSlug !== null) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .map((row) => {
      const { createdAt, ...banner } = row;
      void createdAt;
      return banner;
    });
}

export interface FaqGroup {
  category: FaqCategory;
  items: { id: string; question: string; answerMd: string; position: number }[];
}

/** Published FAQs grouped by category (fixed category order, empty categories omitted). */
export async function getFaqs(db: DbClient): Promise<FaqGroup[]> {
  const rows = await db
    .select()
    .from(faqs)
    .where(eq(faqs.published, true))
    .orderBy(asc(faqs.position), asc(faqs.createdAt), asc(faqs.id));
  return FAQ_CATEGORY_ORDER.map((category) => ({
    category,
    items: rows
      .filter((r) => r.category === category)
      .map((r) => ({
        id: r.id,
        question: r.question,
        answerMd: r.answerMd,
        position: r.position,
      })),
  })).filter((g) => g.items.length > 0);
}

export interface PolicyDoc {
  slug: string;
  title: string;
  bodyMd: string;
  version: number;
  effectiveAt: Date | null;
}

/**
 * The latest published version of a policy. The `policies` row is the current version; if it is
 * not published (e.g. a new version is being drafted) the newest row in `policy_versions` is
 * served instead so a legally required policy is never missing. Unknown slug -> null.
 */
export async function getPolicy(db: DbClient, slug: string): Promise<PolicyDoc | null> {
  const [policy] = await db.select().from(policies).where(eq(policies.slug, slug)).limit(1);
  if (!policy) return null;
  if (policy.published) {
    return {
      slug: policy.slug,
      title: policy.title,
      bodyMd: policy.bodyMd,
      version: policy.version,
      effectiveAt: policy.effectiveAt,
    };
  }
  const [latest] = await db
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.policyId, policy.id))
    .orderBy(desc(policyVersions.version))
    .limit(1);
  return latest
    ? {
        slug: policy.slug,
        title: latest.title,
        bodyMd: latest.bodyMd,
        version: latest.version,
        effectiveAt: latest.effectiveAt,
      }
    : null;
}

/** Slug + title of every policy that has a published version (footer / cart / checkout links). */
export async function listPublishedPolicies(
  db: DbClient,
): Promise<{ slug: string; title: string }[]> {
  const rows = await db
    .select({ slug: policies.slug, title: policies.title, published: policies.published, id: policies.id })
    .from(policies)
    .orderBy(asc(policies.title));
  const out: { slug: string; title: string }[] = [];
  for (const r of rows) {
    if (r.published) out.push({ slug: r.slug, title: r.title });
    else {
      const [v] = await db
        .select({ title: policyVersions.title })
        .from(policyVersions)
        .where(eq(policyVersions.policyId, r.id))
        .orderBy(desc(policyVersions.version))
        .limit(1);
      if (v) out.push({ slug: r.slug, title: v.title });
    }
  }
  return out;
}
