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
        "mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {back ? (
          <Link
            href={back.href}
            className="group mb-1.5 inline-flex items-center gap-0.5 text-[13px] text-admin-ink-muted transition-colors hover:text-admin-primary"
          >
            <ChevronLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden />
            {back.label}
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl leading-tight font-bold tracking-tight text-admin-ink sm:text-[1.75rem]">
            {title}
          </h1>
          {badges}
        </div>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-admin-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
