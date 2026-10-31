import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DraftBanner } from "@/components/content/DraftBanner";
import { FinalisingNotice } from "@/components/content/FinalisingNotice";
import { PolicyProse } from "@/components/content/PolicyProse";
import { PolicyToc } from "@/components/content/PolicyToc";
import { POLICY_LINKS } from "@/components/store/footer/Footer";
import { Breadcrumbs } from "@/components/store/listing/CollectionHeader";
import type { Crumb } from "@/lib/seo";
import { getStoreInfo } from "@/server/cache/settings";
import { getPolicyPage } from "@/server/content/cached";
import { POLICY_SLUGS, isPolicySlug } from "@/server/content/policies";

/**
 * Known policy slugs are prerendered. `params` is read first so an unknown slug renders the themed
 * not-found page (same approach as the vibe and product pages). The body is only shown when the policy is
 * published and fully resolved; development builds show it as a marked-up draft instead
 * (`server/content/publish.ts`).
 */
export const instant = false;

export function generateStaticParams() {
  return POLICY_SLUGS.map((slug) => ({ slug }));
}

const fallbackTitle = (slug: string) => POLICY_LINKS.find((p) => p.slug === slug)?.label ?? "Policy";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isPolicySlug(slug)) return {};
  const policy = await getPolicyPage(slug);
  const hidden = !policy || policy.withheld !== null || policy.draft;
  return {
    title: policy?.title ?? fallbackTitle(slug),
    alternates: { canonical: `/policies/${slug}` },
    robots: hidden ? { index: false, follow: true } : undefined,
  };
}

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "UTC" });

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isPolicySlug(slug)) notFound();
  const [policy, info] = await Promise.all([getPolicyPage(slug), getStoreInfo()]);

  const title = policy?.title ?? fallbackTitle(slug);
  const crumbs: Crumb[] = [
    { name: "Home", path: "/" },
    { name: "Policies", path: "/policies" },
    { name: title, path: `/policies/${slug}` },
  ];
  const showBody = policy !== null && policy.withheld === null;
  const toc = showBody ? policy.headings.filter((h) => h.depth === 2).length >= 4 : false;

  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-6 pb-4 sm:px-6">
      <Breadcrumbs crumbs={crumbs} />
      <header className="mt-4 flex flex-col gap-2">
        <h1 className="font-display text-4xl leading-tight display-fx sm:text-5xl">{title}</h1>
        {showBody ? (
          <p className="text-base text-ink-muted" data-testid="policy-meta">
            Version {policy.version}
            {policy.effectiveAt
              ? ` · Effective ${dateFormat.format(new Date(policy.effectiveAt))}`
              : " · Not yet in force"}
          </p>
        ) : null}
      </header>

      {showBody && policy.draft ? (
        <div className="mt-6">
          <DraftBanner unpublished={!policy.published} problems={policy.problems} what="policy" />
        </div>
      ) : null}

      {showBody ? (
        <div className={toc ? "mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12" : "mt-8"}>
          <PolicyToc headings={policy.headings} />
          <article
            aria-label={title}
            className="min-w-0 rounded-card border-token bg-surface p-5 shadow-card sm:p-8 lg:p-10"
          >
            <PolicyProse html={policy.html} />
          </article>
        </div>
      ) : (
        <div className="mt-8">
          <FinalisingNotice supportEmail={info.supportEmail} />
        </div>
      )}
    </div>
  );
}
