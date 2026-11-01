import Link from "next/link";

import { VIBES } from "@/features/vibe/config";
import { cn } from "@/lib/cn";

import { FALLBACK_LOGO_TAGLINE, LOGO_TAGLINES } from "./logo-taglines";

/**
 * Wordmark link home: "IfOnli" in the vibe's display font and accent colour, with the vibe's tagline under it
 * (from `sm` up). The taglines are all in the markup as `<span data-v>` variants and CSS shows the active
 * one, so the right line is there before hydration. Server component.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/home"
      aria-label="IfOnli, home"
      className={cn("inline-flex min-h-11 flex-col justify-center rounded-input leading-none", className)}
    >
      <span className="font-display text-[1.875rem] leading-none text-accent">IfOnli</span>
      <span aria-hidden="true" className="mt-1 hidden text-xs leading-tight text-ink-muted sm:block">
        {VIBES.map((v) => (
          <span key={v} data-v={v}>
            {LOGO_TAGLINES[v] ?? FALLBACK_LOGO_TAGLINE}
          </span>
        ))}
      </span>
    </Link>
  );
}
