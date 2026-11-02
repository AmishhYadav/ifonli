import type { ComponentProps } from "react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * The header's search button. From `md` up it is a pill that looks like a search box ("Search charms...");
 * below that, a round icon button. One element in both sizes, so Radix can use it as the dialog trigger and
 * return focus to it. The accessible name is "Search charms", which contains the visible text.
 */
export function SearchTrigger({ className, ...rest }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label="Search charms"
      aria-haspopup="dialog"
      className={cn(
        "inline-flex size-11 flex-none items-center justify-center rounded-full text-ink transition-colors ease-vibe",
        "hover:bg-surface-2",
        "md:h-11 md:w-56 md:justify-start md:gap-2.5 md:border md:border-hairline md:bg-surface md:px-4 md:text-ink-muted md:hover:bg-surface md:hover:text-ink lg:w-80",
        "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        className,
      )}
      {...rest}
    >
      <Icon name="search" className="size-7 md:size-5" />
      <span aria-hidden="true" className="hidden text-sm md:inline">
        Search charms...
      </span>
    </button>
  );
}
