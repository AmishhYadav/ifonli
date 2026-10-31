import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import Link from "next/link";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@/components/admin/ui";
import { inputClasses } from "@/components/admin/ui/input";
import type { AuditFacets, AuditFilters, AuditPage, AuditRow } from "@/server/services/admin/audit";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Kolkata",
});

/** Query string for the current filters (plus a page), omitting empty values. */
export function auditQuery(filters: AuditFilters, page?: number): string {
  const params = new URLSearchParams();
  const entries: [string, string | undefined][] = [
    ["actorId", filters.actorId],
    ["actor", filters.actor],
    ["entity", filters.entity],
    ["entityId", filters.entityId],
    ["action", filters.action],
    ["from", filters.from],
    ["to", filters.to],
    ["page", page && page > 1 ? String(page) : undefined],
  ];
  for (const [k, v] of entries) if (v) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Pretty JSON, collapsed by default. before / after pairs and `{ field: { from, to } }` diffs both read fine. */
function DiffView({ diff, id }: { diff: unknown; id: string }) {
  if (diff === null || diff === undefined) return <span className="text-admin-ink-faint">—</span>;
  const json = JSON.stringify(diff, null, 2);
  const size = json.split("\n").length;
  return (
    <details className="group" data-testid="audit-diff">
      <summary className="cursor-pointer text-[13px] text-admin-primary hover:underline">
        {size} {size === 1 ? "line" : "lines"}
        <span className="sr-only"> of changes for entry {id}</span>
      </summary>
      <pre className="mt-1.5 max-h-80 max-w-[34rem] overflow-auto rounded-md bg-admin-surface-2 p-3 font-mono text-xs leading-5 whitespace-pre-wrap">
        {json}
      </pre>
    </details>
  );
}

function Row({ row }: { row: AuditRow }) {
  return (
    <TableRow data-testid="audit-row">
      <TableCell className="text-[13px] whitespace-nowrap">
        {dateTime.format(row.createdAt)}
      </TableCell>
      <TableCell>
        {row.actorName ? (
          <>
            <span className="font-medium">{row.actorName}</span>
            <span className="block text-xs text-admin-ink-muted">{row.actorEmail}</span>
          </>
        ) : (
          <span className="text-admin-ink-muted">{row.actorId ? "Deleted user" : "System"}</span>
        )}
      </TableCell>
      <TableCell>
        <Badge tone="neutral" className="font-mono">
          {row.action}
        </Badge>
      </TableCell>
      <TableCell>
        <span className="text-[13px]">{row.entity}</span>
        {row.entityId ? (
          <span
            className="block max-w-[14rem] truncate font-mono text-xs text-admin-ink-muted"
            title={row.entityId}
          >
            {row.entityId}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="font-mono text-xs text-admin-ink-muted">{row.ip ?? "—"}</TableCell>
      <TableCell>
        <DiffView diff={row.diff} id={row.id.slice(0, 8)} />
      </TableCell>
    </TableRow>
  );
}

export function AuditLog({
  page,
  filters,
  facets,
}: {
  page: AuditPage;
  filters: AuditFilters;
  facets: AuditFacets;
}) {
  const hasFilters = Object.values(filters).some(Boolean);
  const select = (
    name: string,
    label: string,
    value: string | undefined,
    options: { value: string; label: string }[],
  ) => (
    <Field label={label} htmlFor={`audit-${name}`}>
      <select
        id={`audit-${name}`}
        name={name}
        defaultValue={value ?? ""}
        className={cn(inputClasses, "h-9")}
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
  const prev = page.page > 1 ? `/admin/audit${auditQuery(filters, page.page - 1)}` : null;
  const next =
    page.page < page.pageCount ? `/admin/audit${auditQuery(filters, page.page + 1)}` : null;
  const from = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.total, page.page * page.pageSize);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <form
          method="get"
          action="/admin/audit"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          role="search"
          aria-label="Filter the audit log"
        >
          {select(
            "actorId",
            "Who",
            filters.actorId,
            facets.actors.map((a) => ({ value: a.id, label: a.label })),
          )}
          {select(
            "entity",
            "What (entity)",
            filters.entity,
            facets.entities.map((e) => ({ value: e, label: e })),
          )}
          {select(
            "action",
            "Action",
            filters.action,
            facets.actions.map((a) => ({ value: a, label: a })),
          )}
          <Field
            label="Record id"
            htmlFor="audit-entityId"
            hint="Product id, setting key, policy slug…"
          >
            <Input
              id="audit-entityId"
              name="entityId"
              defaultValue={filters.entityId ?? ""}
              autoComplete="off"
            />
          </Field>
          <Field label="From (India date)" htmlFor="audit-from">
            <Input id="audit-from" name="from" type="date" defaultValue={filters.from ?? ""} />
          </Field>
          <Field label="To (India date)" htmlFor="audit-to">
            <Input id="audit-to" name="to" type="date" defaultValue={filters.to ?? ""} />
          </Field>
          <Field label="Person contains" htmlFor="audit-actor" hint="Name or email.">
            <Input
              id="audit-actor"
              name="actor"
              defaultValue={filters.actor ?? ""}
              autoComplete="off"
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit">Filter</Button>
            {hasFilters ? (
              <Button variant="ghost" asChild>
                <Link href="/admin/audit">Clear</Link>
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="text-[13px] text-admin-ink-muted"
          aria-live="polite"
          data-testid="audit-count"
        >
          {page.total === 0
            ? "No entries match."
            : `${from}–${to} of ${page.total.toLocaleString("en-IN")} ${page.total === 1 ? "entry" : "entries"}, newest first`}
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href={`/admin/audit/export${auditQuery(filters)}`} download>
            <Download aria-hidden /> Download CSV
          </a>
        </Button>
      </div>

      {page.items.length === 0 ? (
        <EmptyState
          title={hasFilters ? "Nothing matches these filters" : "Nothing recorded yet"}
          description={
            hasFilters
              ? "Try a wider date range or clear a filter."
              : "Changes made in the admin appear here."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-admin-border bg-admin-surface shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When (IST)</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Changes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {page.pageCount > 1 ? (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-2 text-xs text-admin-ink-muted"
        >
          <span>
            Page {page.page} of {page.pageCount}
          </span>
          <div className="flex items-center gap-1">
            {prev ? (
              <Button variant="outline" size="icon-sm" asChild>
                <Link href={prev} aria-label="Previous page" rel="prev">
                  <ChevronLeft aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="icon-sm" disabled aria-label="Previous page">
                <ChevronLeft aria-hidden />
              </Button>
            )}
            {next ? (
              <Button variant="outline" size="icon-sm" asChild>
                <Link href={next} aria-label="Next page" rel="next">
                  <ChevronRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="icon-sm" disabled aria-label="Next page">
                <ChevronRight aria-hidden />
              </Button>
            )}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
