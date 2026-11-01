import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { AnalyticsFooterLink } from "@/features/analytics/AnalyticsMount";
import { getCollections } from "@/server/cache/catalog";
import { getStoreInfo } from "@/server/cache/settings";

import { Logo } from "../header/Logo";

import { PlaceholderValue } from "./PlaceholderValue";

/** Policy pages (plan FR-15): linked from every page footer. */
export const POLICY_LINKS = [
  { slug: "shipping", label: "Shipping policy" },
  { slug: "cancellation", label: "Cancellation policy" },
  { slug: "returns-refunds", label: "Returns and refunds" },
  { slug: "privacy", label: "Privacy policy" },
  { slug: "terms", label: "Terms of use" },
  { slug: "grievance", label: "Grievance redressal" },
  { slug: "seller-information", label: "Seller information" },
] as const;

const linkClass =
  "inline-flex min-h-11 items-center text-base text-ink underline-offset-4 hover:underline md:min-h-9";

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-display text-lg">{title}</h2>
      {children}
    </section>
  );
}

export async function Footer() {
  const [info, collections] = await Promise.all([getStoreInfo(), getCollections()]);
  const officer = info.grievance;

  return (
    <footer className="mt-20 border-t border-border bg-surface text-ink below-fold [--cv-h:30rem]">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1.4fr]">
        <div className="flex flex-col gap-3">
          <Logo className="self-start" />
          <p className="max-w-xs text-base text-ink-muted">
            Charms, Hippers, 3D stickers and DIY kits in four moods. Made in India.
          </p>
          <ul className="flex flex-wrap gap-x-4">
            {collections.vibes.map((v) => (
              <li key={v.slug}>
                <Link href={`/vibes/${v.slug}`} className={`${linkClass} min-w-11 justify-center`}>
                  {v.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <Column title="Shop and help">
          <ul>
            <li>
              <Link href="/shop" className={linkClass}>
                Shop all
              </Link>
            </li>
            {collections.types.map((t) => (
              <li key={t.slug}>
                <Link href={`/types/${t.slug}`} className={linkClass}>
                  {t.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/track" className={linkClass}>
                Track your order
              </Link>
            </li>
            <li>
              <Link href="/help" className={linkClass}>
                Help and contact
              </Link>
            </li>
          </ul>
        </Column>

        <Column title="Policies">
          <ul>
            {POLICY_LINKS.map((p) => (
              <li key={p.slug}>
                <Link href={`/policies/${p.slug}`} className={linkClass}>
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </Column>

        <Column title="Store details">
          <address className="flex flex-col gap-3 text-base not-italic text-ink">
            <p>
              <span className="block font-semibold">
                <PlaceholderValue value={info.legalName} />
              </span>
              <PlaceholderValue value={info.registeredAddress} />
            </p>
            <p className="flex flex-col gap-1">
              <span className="flex items-start gap-2">
                <Icon name="mail" className="mt-1 size-4 flex-none" />
                <PlaceholderValue value={info.supportEmail}>
                  <a href={`mailto:${info.supportEmail.value}`} className="underline underline-offset-4">
                    {info.supportEmail.value}
                  </a>
                </PlaceholderValue>
              </span>
              <span className="flex items-start gap-2">
                <Icon name="phone" className="mt-1 size-4 flex-none" />
                <PlaceholderValue value={info.supportPhone} />
              </span>
              <span className="pl-6 text-ink-muted">
                <PlaceholderValue value={info.supportHours} />
              </span>
            </p>
            <p>
              <span className="block font-semibold">Grievance officer</span>
              <PlaceholderValue value={officer.name} />, <PlaceholderValue value={officer.designation} />
              <br />
              <PlaceholderValue value={officer.email}>
                <a href={`mailto:${officer.email.value}`} className="underline underline-offset-4">
                  {officer.email.value}
                </a>
              </PlaceholderValue>
              {" / "}
              <PlaceholderValue value={officer.phone} />
            </p>
          </address>
        </Column>
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-[1440px] px-4 py-5 text-sm text-ink-muted sm:px-6">
          All prices are in Indian rupees and include all taxes. &copy; {info.brandName}{" "}
          <AnalyticsFooterLink className="ml-2 inline-flex min-h-11 items-center text-ink underline underline-offset-4 hover:no-underline md:min-h-9" />
        </p>
      </div>
    </footer>
  );
}
