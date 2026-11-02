import Link from "next/link";

import { VIBES } from "@/features/vibe/config";
import { cn } from "@/lib/cn";

import { FALLBACK_LOGO_TAGLINE, LOGO_TAGLINES } from "./logo-taglines";

/**
 * Wordmark link home: "IfOnli" in the vibe's display font and accent colour. With `tagline` (the storefront
 * header) the vibe's tagline sits under it from `sm` up. The tagline is a sibling of the link, not inside it:
 * the link's name is "IfOnli, home", and visible text inside a link that is not part of its accessible name
 * fails WCAG 2.5.3 (axe label-content-name-mismatch). The taglines are all in the markup as `<span data-v>`
 * variants and CSS shows the active one, so the right line is there before hydration. Server component.
 */
export function Logo({ className, tagline = false }: { className?: string; tagline?: boolean }) {
  return (
    <div className={cn("inline-flex min-h-11 flex-col justify-center leading-none", className)}>
      <Link
        href="/home"
        aria-label="IfOnli, home"
        className="inline-flex min-h-11 items-center self-start rounded-input font-display text-[1.875rem] leading-none text-accent sm:min-h-0"
      >
        IfOnli
      </Link>
      {tagline ? (
        <span aria-hidden="true" className="mt-1.5 hidden text-xs leading-tight text-ink-muted sm:block">
          {VIBES.map((v) => (
            <span key={v} data-v={v}>
              {LOGO_TAGLINES[v] ?? FALLBACK_LOGO_TAGLINE}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}
