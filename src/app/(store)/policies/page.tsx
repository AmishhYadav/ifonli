import type { Metadata } from "next";
import Link from "next/link";

import { FinalisingNotice } from "@/components/content/FinalisingNotice";
import { Breadcrumbs } from "@/components/store/listing/CollectionHeader";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { Crumb } from "@/lib/seo";
import { getStoreInfo } from "@/server/cache/settings";
import { getPolicyIndex } from "@/server/content/cached";
import type { PolicySlug } from "@/server/content/policies";

export const instant = false;

export const metadata: Metadata = {
  title: "Policies",
  description: "Shipping, cancellation, returns and refunds, privacy, terms of use and how to reach us with a complaint.",
  alternates: { canonical: "/policies" },
};

const BLURBS: Record<PolicySlug, string> = {
  shipping: "Where we deliver, how long it takes and what it costs.",
  cancellation: "When you can cancel an order and how refunds work.",
  "returns-refunds": "Returns, replacements and refunds for damaged or wrong items.",
  privacy: "What personal data we collect, why, and your rights.",
  terms: "The rules for using the site and buying from us.",
  grievance: "Who to contact with a complaint, and how fast we respond.",
  "seller-information": "Who we are, where we are registered and how to reach us.",
};

const crumbs: Crumb[] = [
  { name: "Home", path: "/home" },
  { name: "Policies", path: "/policies" },
];

export default async function PoliciesPage() {
  const [index, info] = await Promise.all([getPolicyIndex(), getStoreInfo()]);
  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-6 pb-4 sm:px-6">
      <Breadcrumbs crumbs={crumbs} />
      <header className="mt-4 flex flex-col gap-2">
        <h1 className="font-display text-4xl leading-tight display-fx sm:text-5xl">Policies</h1>
        <p className="max-w-2xl text-lg text-ink-muted">
          The fine print, written to be read. Questions? <Link href="/help" className="font-semibold text-link underline underline-offset-4">Help and contact</Link>.
        </p>
      </header>
      {index.length === 0 ? (
        <div className="mt-8">
          <FinalisingNotice supportEmail={info.supportEmail} />
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {index.map((policy) => (
            <li key={policy.slug}>
              <Link
                href={`/policies/${policy.slug}`}
                className="flex h-full min-h-24 flex-col gap-1.5 rounded-card border-token bg-surface p-4 text-ink shadow-card transition-transform ease-vibe hover:-translate-y-0.5 sm:p-5"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="font-display text-xl leading-tight">{policy.title}</span>
                  <Icon name="arrow-right" className="mt-1 size-5 flex-none" />
                </span>
                <span className="text-base text-ink-muted">
                  {BLURBS[policy.slug as PolicySlug]}
                </span>
                {!policy.published ? <Badge tone="warning" className="self-start">Draft</Badge> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
