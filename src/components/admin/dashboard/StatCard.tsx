import Link from "next/link";

import { Card, cn } from "@/components/admin/ui";

/** One headline number. A link when `href` is given. */
export function StatCard({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: "warning" | "danger";
}) {
  const body = (
    <Card className={cn("h-full p-4 transition-colors", href && "group-hover:border-admin-border-strong")}>
      <p className="text-xs text-admin-ink-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-2xl font-semibold",
          tone === "warning" && "text-admin-warning",
          tone === "danger" && "text-admin-danger",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-admin-ink-muted">{hint}</p> : null}
    </Card>
  );
  return href ? (
    <Link href={href} className="group block">
      {body}
    </Link>
  ) : (
    body
  );
}
