import type { Metadata } from "next";
import Link from "next/link";

import { ContactForm } from "@/components/content/ContactForm";
import { FaqList } from "@/components/content/FaqList";
import { PlaceholderValue } from "@/components/store/footer/PlaceholderValue";
import { JsonLd } from "@/components/store/JsonLd";
import { Breadcrumbs } from "@/components/store/listing/CollectionHeader";
import { Icon, type IconName } from "@/components/ui";
import { breadcrumbJsonLd, type Crumb } from "@/lib/seo";
import { getStoreInfo } from "@/server/cache/settings";
import { getHelpFaqs } from "@/server/content/cached";
import { isReviewMode } from "@/server/content/publish";

export const instant = false;

export const metadata: Metadata = {
  title: "Help and contact",
  description: "Answers about delivery, payment, our products and your order, and how to reach us.",
  alternates: { canonical: "/help" },
};

const crumbs: Crumb[] = [
  { name: "Home", path: "/" },
  { name: "Help and contact", path: "/help" },
];

const QUICK_LINKS: { href: string; label: string; hint: string; icon: IconName }[] = [
  { href: "/track", label: "Track your order", hint: "Reference plus email or mobile", icon: "truck" },
  { href: "/policies/shipping", label: "Shipping", hint: "Where, how long, how much", icon: "package" },
  { href: "/policies/returns-refunds", label: "Returns and refunds", hint: "Damaged or wrong items", icon: "refresh" },
  { href: "/policies", label: "All policies", hint: "Privacy, terms and more", icon: "shield-check" },
];

export default async function HelpPage() {
  const [groups, info] = await Promise.all([getHelpFaqs(), getStoreInfo()]);
  const hasDraftAnswers = isReviewMode() && groups.some((g) => g.items.some((i) => i.draft));
  // Only finished answers go into structured data (a draft answer carries placeholder markers).
  const faqEntities = groups.flatMap((g) =>
    g.items
      .filter((i) => !i.draft)
      .map((i) => ({
        "@type": "Question",
        name: i.question,
        acceptedAnswer: { "@type": "Answer", text: i.text },
      })),
  );

  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-6 pb-4 sm:px-6">
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      {faqEntities.length > 0 ? (
        <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqEntities }} />
      ) : null}
      <Breadcrumbs crumbs={crumbs} />
      <header className="mt-4 flex flex-col gap-2">
        <h1 className="font-display text-4xl leading-tight display-fx sm:text-5xl">Help and contact</h1>
        <p className="max-w-2xl text-lg text-ink-muted">
          Find an answer below, or write to us. A real person reads every message.
        </p>
      </header>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="flex h-full min-h-20 items-start gap-3 rounded-card border-token bg-surface p-4 text-ink shadow-card transition-transform ease-vibe hover:-translate-y-0.5"
            >
              <Icon name={link.icon} className="mt-0.5 size-6 flex-none" />
              <span className="flex flex-col">
                <span className="font-semibold">{link.label}</span>
                <span className="text-sm text-ink-muted">{link.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {groups.length > 0 ? (
        <section aria-labelledby="faq-heading" className="mt-14">
          <h2 id="faq-heading" className="mb-5 font-display text-3xl leading-tight">
            Common questions
          </h2>
          {hasDraftAnswers ? (
            <p
              data-testid="faq-draft-note"
              className="mb-5 rounded-input border-token border-warning bg-surface p-3 text-base"
            >
              <strong>Draft preview.</strong> Answers with highlighted values are hidden in production until
              the settings behind them are filled in.
            </p>
          ) : null}
          <FaqList groups={groups} />
        </section>
      ) : null}

      <section aria-labelledby="contact-heading" className="mt-14">
        <h2 id="contact-heading" className="mb-5 font-display text-3xl leading-tight">
          Still need help?
        </h2>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="flex flex-col gap-4 rounded-card border-token bg-surface p-5 text-base shadow-card">
            <p className="font-display text-xl leading-tight">Talk to us</p>
            <p className="flex items-start gap-2">
              <Icon name="mail" className="mt-1 size-4 flex-none" />
              <PlaceholderValue value={info.supportEmail}>
                <a href={`mailto:${info.supportEmail.value}`} className="font-semibold text-link underline underline-offset-4">
                  {info.supportEmail.value}
                </a>
              </PlaceholderValue>
            </p>
            <p className="flex items-start gap-2">
              <Icon name="phone" className="mt-1 size-4 flex-none" />
              <PlaceholderValue value={info.supportPhone} />
            </p>
            <p className="text-ink-muted">
              Support hours: <PlaceholderValue value={info.supportHours} />
              <br />
              We usually reply <PlaceholderValue value={info.responseTime} />.
            </p>
            <p className="text-ink-muted">
              Placing a complaint? See the{" "}
              <Link href="/policies/grievance" className="font-semibold text-link underline underline-offset-4">
                grievance redressal policy
              </Link>
              .
            </p>
          </div>
          <ContactForm />
        </div>
      </section>
    </div>
  );
}
