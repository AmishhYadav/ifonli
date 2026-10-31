import { AlertTriangle, CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import Link from "next/link";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/ui";
import type { LaunchItem, LaunchReadiness } from "@/server/services/admin/launch";
import { LAUNCH_CATEGORY_LABELS } from "@/server/services/admin/launch";

function ItemRow({ item }: { item: LaunchItem }) {
  return (
    <li
      className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5"
      data-testid="launch-item"
      data-severity={item.severity}
    >
      <span className="mt-0.5" aria-hidden>
        {item.severity === "blocker" ? (
          <XCircle className="size-4 text-admin-danger" />
        ) : (
          <AlertTriangle className="size-4 text-admin-warning" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          <span className="sr-only">{item.severity === "blocker" ? "Blocker: " : "Warning: "}</span>
          {item.title}
        </p>
        {item.detail ? <p className="text-[13px] text-admin-ink-muted">{item.detail}</p> : null}
        {item.links?.length ? (
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
            {item.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-admin-primary hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {item.href ? (
        <Link
          href={item.href}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-admin-primary hover:underline"
          aria-label={`Fix: ${item.title}`}
        >
          Fix <ExternalLink className="size-3" aria-hidden />
        </Link>
      ) : (
        <span className="text-xs text-admin-ink-muted">Hosting settings</span>
      )}
    </li>
  );
}

/** "Ready to launch: yes / no" with every remaining blocker and warning, each linking to its fix. */
export function LaunchPanel({ readiness }: { readiness: LaunchReadiness }) {
  const { ready, blockers, warnings, items } = readiness;
  return (
    <div className="flex flex-col gap-5" data-testid="launch-panel">
      <Card className={ready ? "border-admin-success/50" : "border-admin-danger/40"}>
        <CardContent className="flex flex-wrap items-center gap-4 pt-5">
          {ready ? (
            <CheckCircle2 className="size-9 text-admin-success" aria-hidden />
          ) : (
            <XCircle className="size-9 text-admin-danger" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold" data-testid="launch-verdict">
              Ready to launch: {ready ? "Yes" : "No"}
            </p>
            <p className="text-[13px] text-admin-ink-muted">
              {ready
                ? warnings > 0
                  ? `No blockers. ${warnings} ${warnings === 1 ? "warning" : "warnings"} to look at.`
                  : "Nothing is blocking launch."
                : `${blockers} ${blockers === 1 ? "thing blocks" : "things block"} launch${warnings > 0 ? `, plus ${warnings} ${warnings === 1 ? "warning" : "warnings"}` : ""}.`}
            </p>
          </div>
          <ul className="flex basis-full flex-wrap gap-1.5">
            {readiness.categories.map((c) => (
              <li key={c.id}>
                <Badge tone={c.blockers > 0 ? "danger" : c.warnings > 0 ? "warning" : "success"}>
                  {c.label}:{" "}
                  {c.blockers > 0
                    ? `${c.blockers} to fix`
                    : c.warnings > 0
                      ? `${c.warnings} to check`
                      : "ready"}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {readiness.categories
        .filter((c) => c.blockers + c.warnings > 0)
        .map((c) => {
          const list = items.filter((i) => i.category === c.id);
          const body = (
            <ul className="divide-y divide-admin-border" aria-label={LAUNCH_CATEGORY_LABELS[c.id]}>
              {list.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </ul>
          );
          return (
            <Card key={c.id} data-testid={`launch-category-${c.id}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {c.label}
                  {c.blockers > 0 ? <Badge tone="danger">{c.blockers} to fix</Badge> : null}
                  {c.warnings > 0 ? <Badge tone="warning">{c.warnings} to check</Badge> : null}
                </CardTitle>
                {c.id === "environment" ? (
                  <CardDescription>
                    Checked against this server&apos;s environment variables (values are never
                    shown). Change them in the hosting dashboard.
                  </CardDescription>
                ) : null}
              </CardHeader>
              {c.id === "settings" && list.length > 8 ? (
                <details open={false} className="border-t border-admin-border">
                  <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium text-admin-primary">
                    Show all {list.length} settings that are still placeholders
                  </summary>
                  {body}
                </details>
              ) : (
                <div className="border-t border-admin-border">{body}</div>
              )}
            </Card>
          );
        })}
    </div>
  );
}
