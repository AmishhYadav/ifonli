import Link from "next/link";

import { cn } from "@/lib/cn";

import { LogoTagline } from "./LogoTagline";

/**
 * Wordmark link home: "IfOnli" in the vibe's display font and accent colour. With `tagline` (the storefront
 * header) the vibe's tagline sits under it from `sm` up. The tagline is a sibling of the link, not inside it:
 * the link's name is "IfOnli, home", and visible text inside a link that is not part of its accessible name
 * fails WCAG 2.5.3 (axe label-content-name-mismatch). The line is "If only it was available." everywhere
 * on the home page; elsewhere the worn mood's line (see LogoTagline). Server component.
 */
export function Logo({ className, tagline = false }: { className?: string; tagline?: boolean }) {
  return (
    <div className={cn("inline-flex min-h-11 flex-col justify-center leading-none", className)}>
      <Link
        href="/home"
        aria-label="IfOnli, home"
        className="inline-flex min-h-11 items-center self-start rounded-input font-display text-[1.875rem] leading-none text-accent in-data-[vibe=bold]:max-[419px]:text-2xl sm:min-h-0"
      >
        IfOnli
      </Link>
      {tagline ? (
        <span aria-hidden="true" className="mt-1.5 hidden text-xs leading-tight text-ink-muted sm:block">
          <LogoTagline />
        </span>
      ) : null}
    </div>
  );
}
