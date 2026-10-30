import Link from "next/link";

import { POLICY_LINKS } from "./Footer";

/** Small footer for cart and checkout pages: policy links only (FR-15), no marketing. */
export function BuyFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-surface text-ink">
      <nav aria-label="Policies" className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <ul className="flex flex-wrap gap-x-5">
          {POLICY_LINKS.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/policies/${p.slug}`}
                className="inline-flex min-h-11 items-center text-sm text-ink underline underline-offset-4 hover:no-underline"
              >
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
