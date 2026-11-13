import * as React from "react";

import { cn } from "./cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-admin-border-strong bg-admin-surface px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 flex size-12 items-center justify-center rounded-2xl bg-admin-primary-soft text-admin-primary ring-1 ring-admin-coral/30 [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <h2 className="text-base font-semibold text-admin-ink">{title}</h2>
      {description ? (
        <p className="max-w-sm text-[13px] text-admin-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
