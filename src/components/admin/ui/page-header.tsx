import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "./cn";

export function PageHeader({
  title,
  description,
  actions,
  back,
  badges,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  badges?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {back ? (
          <Link
            href={back.href}
            className="mb-1 inline-flex items-center gap-0.5 text-[13px] text-admin-ink-muted hover:text-admin-ink"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            {back.label}
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl leading-tight font-semibold tracking-tight text-admin-ink">
            {title}
          </h1>
          {badges}
        </div>
        {description ? (
          <p className="mt-1 max-w-2xl text-[13px] text-admin-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
