import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import type { Crumb } from "@/lib/seo";

/** Breadcrumb trail (visible; the matching JSON-LD is emitted by the page). */
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={crumb.path} className="flex items-center gap-1">
              {last ? (
                <span aria-current="page" className="font-semibold text-ink">
                  {crumb.name}
                </span>
              ) : (
                <>
                  <Link href={crumb.path} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline max-md:min-w-11 max-md:justify-center md:min-h-8">
                    {crumb.name}
                  </Link>
                  <Icon name="chevron-right" className="size-3.5" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface CollectionHeaderProps {
  crumbs: readonly Crumb[];
  title: ReactNode;
  description?: ReactNode;
  /** Extra row under the description (counts, buttons). */
  children?: ReactNode;
}

/** Plain (site-themed) collection header for /shop and /types/[type]. */
export function CollectionHeader({ crumbs, title, description, children }: CollectionHeaderProps) {
  return (
    <header className="mx-auto max-w-[1440px] px-4 pt-6 pb-2 sm:px-6">
      <Breadcrumbs crumbs={crumbs} />
      <h1 className="mt-3 font-display text-4xl leading-tight display-fx sm:text-5xl">{title}</h1>
      {description ? <p className="mt-2 max-w-2xl text-lg text-ink-muted">{description}</p> : null}
      {children}
    </header>
  );
}
