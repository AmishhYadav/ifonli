"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { Icon } from "@/components/ui/Icon";

export interface FooterMood {
  slug: string;
  name: string;
  tagline: string;
}

/**
 * The four moods as 3D-text buttons (styles in ui.css). Pressing one shows its tagline and a link to the
 * mood's page underneath; pressing it again hides it.
 */
export function FooterMoods({ moods }: { moods: readonly FooterMood[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const panelId = useId();
  const current = moods.find((m) => m.slug === open);

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2">
        {moods.map((m) => (
          <li key={m.slug}>
            <button
              type="button"
              className="mood-3d"
              aria-expanded={open === m.slug}
              aria-controls={panelId}
              onClick={() => setOpen((cur) => (cur === m.slug ? null : m.slug))}
            >
              {m.name}
            </button>
          </li>
        ))}
      </ul>
      <div id={panelId} aria-live="polite">
        {current ? (
          <p key={current.slug} className="mood-3d__tagline">
            <span className="block text-lg font-semibold text-ink">&ldquo;{current.tagline}&rdquo;</span>
            <Link
              href={`/vibes/${current.slug}`}
              className="inline-flex min-h-11 items-center gap-1 text-base font-semibold text-link underline underline-offset-4 hover:no-underline md:min-h-9"
            >
              Shop {current.name}
              <Icon name="arrow-right" className="size-4" />
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
