import Link from "next/link";

import { cn } from "@/lib/cn";

/** Wordmark link home. Text for now (no logo asset yet); the display font follows the vibe. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="IfOnli, home"
      className={cn(
        "inline-flex min-h-11 items-center rounded-input font-display text-2xl leading-none text-ink",
        className,
      )}
    >
      If<span className="text-link">Onli</span>
    </Link>
  );
}
