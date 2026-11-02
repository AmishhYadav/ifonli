import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { Icon, type IconName } from "./Icon";

export interface EmptyStateProps {
  /** Sprite icon, or pass `illustration` for custom art. */
  icon?: IconName;
  illustration?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  /** Usually a Button or link. */
  action?: ReactNode;
  headingLevel?: "h2" | "h3" | "h4";
  className?: string;
}

export function EmptyState({
  icon,
  illustration,
  title,
  children,
  action,
  headingLevel: Heading = "h3",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-card bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] px-6 py-10 text-center text-ink",
        className,
      )}
    >
      {illustration ?? (
        icon ? (
          <span className="grid size-16 place-items-center rounded-full bg-surface-2 text-ink">
            <Icon name={icon} className="size-8" />
          </span>
        ) : null
      )}
      <Heading className="font-display text-xl leading-tight">{title}</Heading>
      {children ? <p className="max-w-sm text-base text-ink-muted">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
