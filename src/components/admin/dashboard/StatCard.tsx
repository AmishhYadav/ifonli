import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Card, cn } from "@/components/admin/ui";

import { CountUp } from "./CountUp";

/**
 * One headline number: display-face figure that counts up, a cursor spotlight and a small tilt on
 * hover (see PointerFx). A link when `href` is given. `size="hero"` is the larger first-row card.
 */
export function StatCard({
  label,
  value,
  hint,
  href,
  tone,
  icon: Icon,
  size = "md",
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: "warning" | "danger";
  icon?: LucideIcon;
  size?: "md" | "hero";
}) {
  const body = (
    <Card
      data-glow
      data-tilt
      className={cn(
        "admin-glow admin-tilt h-full overflow-hidden p-4 sm:p-5",
        size === "hero" && "sm:p-6",
      )}
    >
      {/* Decorative corner wash in the badge colours. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-[image:var(--admin-grad)] opacity-25 blur-2xl"
      />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-admin-ink-muted">{label}</p>
        {Icon ? (
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-admin-primary-soft text-admin-primary [&_svg]:size-4"
          >
            <Icon />
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "tabular relative mt-2 break-words font-admin-display leading-none font-bold tracking-tight",
          size === "hero" ? "text-[1.625rem] sm:text-[2rem]" : "text-2xl sm:text-[1.75rem]",
          tone === "warning" && "text-admin-warning",
          tone === "danger" && "text-admin-danger",
        )}
      >
        <CountUp value={value} />
      </p>
      {hint ? (
        <p className="relative mt-2 text-xs text-admin-ink-muted" data-visual-mask>
          {hint}
        </p>
      ) : null}
    </Card>
  );
  return href ? (
    <Link href={href} className="group block rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}
