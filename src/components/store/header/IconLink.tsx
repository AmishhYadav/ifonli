import Link from "next/link";
import type { ComponentProps } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

interface IconLinkProps extends Omit<ComponentProps<typeof Link>, "children"> {
  icon: IconName;
  /** Required accessible name (the link has no visible text). */
  label: string;
  /** Marks this link as a fly-to target (`data-fly-target`), see `features/motion/fly`. */
  flyTarget?: "cart" | "wishlist";
}

/** A header icon link: a round 44px target with a soft hover wash, the icon at 28px like the demo. */
export function IconLink({ icon, label, className, flyTarget, ...rest }: IconLinkProps) {
  return (
    <Link
      aria-label={label}
      data-fly-target={flyTarget}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors ease-vibe hover:bg-surface-2",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} className="size-7" />
    </Link>
  );
}
