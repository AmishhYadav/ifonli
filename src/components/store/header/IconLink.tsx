import Link from "next/link";
import type { ComponentProps } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { buttonVariants } from "@/components/ui/buttonStyles";
import { cn } from "@/lib/cn";

interface IconLinkProps extends Omit<ComponentProps<typeof Link>, "children"> {
  icon: IconName;
  /** Required accessible name (the link has no visible text). */
  label: string;
}

/** An icon-only link that looks like a ghost `IconButton` (44px+ target). */
export function IconLink({ icon, label, className, ...rest }: IconLinkProps) {
  return (
    <Link
      aria-label={label}
      className={cn(buttonVariants({ variant: "ghost", size: "md" }), "min-w-12 p-0", className)}
      {...rest}
    >
      <Icon name={icon} className="size-6" />
    </Link>
  );
}
