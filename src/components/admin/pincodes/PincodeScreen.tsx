import { ChevronLeft, ChevronRight, Download, Info } from "lucide-react";
import Link from "next/link";

import { pincodeQuery } from "@/app/admin/(app)/pincodes/filters";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  cn,
} from "@/components/admin/ui";
import { inputClasses } from "@/components/admin/ui/input";
import type {
  PincodeFacets,
  PincodeFilters,
  PincodePage,
  PincodeSummary,
} from "@/server/services/admin/pincodes";

import { BulkPincodeActions } from "./BulkPincodeActions";
import { PincodeCsvImport } from "./PincodeCsvImport";
import { PincodeTable } from "./PincodeTable";

const ZONE_LABELS: Record<string, string> = {
  metro_region: "Metro regions",
  rest_of_india: "Rest of India",
  north_east: "North-east",
  jk_ladakh: "J&K and Ladakh",
  islands: "Islands",
};

const fmt = (n: number) => n.toLocaleString("en-IN");

/** "in Kerala, zone north-east, not serviceable" for the confirmation text. */
function filterLabel(filters: PincodeFilters, facets: PincodeFacets): string {
  const parts: string[] = [];
  if (filters.q) parts.push(/^\d+$/.test(filters.q) ? `pincode starts with ${filters.q}` : `district contains "${filters.q}"`);
  if (filters.stateCode) {
    const name = facets.states.find((s) => s.code === filters.stateCode)?.name;
    parts.push(`state ${name ?? filters.stateCode}`);
  }
  if (filters.zone) parts.push(`zone ${ZONE_LABELS[filters.zone] ?? filters.zone}`);
  if (filters.serviceable !== undefined) parts.push(filters.serviceable ? "serviceable" : "not serviceable");
  if (filters.cod !== undefined) parts.push(filters.cod ? "COD allowed" : "COD off");
  return parts.join(", ");
}

export function PincodeScreen({
  page,
  filters,
  facets,
  summary,
  canEdit,
}: {
  page: PincodePage;
  filters: PincodeFilters;
  facets: PincodeFacets;
  summary: PincodeSummary;
  canEdit: boolean;
}) {
  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== "");
  const label = filterLabel(filters, facets);
  const from = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.total, page.page * page.pageSize);
  const prev = page.page > 1 ? `/admin/pincodes${pincodeQuery(filters, page.page - 1)}` : null;
  const next = page.page < page.pageCount ? `/admin/pincodes${pincodeQuery(filters, page.page + 1)}` : null;

  const tri = (name: string, labelText: string, value: boolean | undefined, yes: string, no: string) => (
    <Field label={labelText} htmlFor={`pin-${name}`}>
      <select
        id={`pin-${name}`}
        name={name}
        defaultValue={value === undefined ? "" : value ? "yes" : "no"}
        className={cn(inputClasses, "h-9")}
      >
        <option value="">Any</option>
        <option value="yes">{yes}</option>
        <option value="no">{no}</option>
      </select>
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex gap-3 p-4">
        <Info className="mt-0.5 size-4 shrink-0 text-admin-info" aria-hidden />
        <div className="grid gap-1.5 text-[13px] text-admin-ink-muted">
          <p>
            <strong className="text-admin-ink">A pincode marked not serviceable is refused at checkout</strong>{" "}
            (and the product page says we cannot deliver there). There is one list, no separate
            allow or deny mode.
          </p>
          <p>
            To serve only some areas, mark everything not serviceable (empty filter, one bulk action) and
            then mark the areas you serve as serviceable, by state or zone. Or the other way round: leave
            everything on and mark the places you do not serve.
          </p>
          <p>
            COD is a separate switch: a pincode can be serviceable and still have COD off. Changes are live
            for shoppers immediately and are recorded in the audit log. New pincodes are added with the
            import script, not here.
          </p>
        </div>
      </Card>

      <p className="flex flex-wrap items-center gap-2 text-[13px] text-admin-ink-muted" data-testid="pincode-summary">
        <span>{fmt(summary.total)} pincodes in the directory</span>
        <Badge tone={summary.notServiceable ? "danger" : "neutral"}>{fmt(summary.notServiceable)} not serviceable</Badge>
        <Badge tone={summary.codOff ? "warning" : "neutral"}>{fmt(summary.codOff)} with COD off</Badge>
      </p>

      <Card className="p-4">
        <form
          method="get"
          action="/admin/pincodes"
          role="search"
          aria-label="Filter the pincodes"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Field label="Pincode or district" htmlFor="pin-q" hint="Digits match the start of a pincode; text matches the district.">
            <Input id="pin-q" name="q" defaultValue={filters.q ?? ""} autoComplete="off" />
          </Field>
          <Field label="State" htmlFor="pin-state">
            <select id="pin-state" name="state" defaultValue={filters.stateCode ?? ""} className={cn(inputClasses, "h-9")}>
              <option value="">Any</option>
              {facets.states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Zone" htmlFor="pin-zone">
            <select id="pin-zone" name="zone" defaultValue={filters.zone ?? ""} className={cn(inputClasses, "h-9")}>
              <option value="">Any</option>
              {facets.zones.map((z) => (
                <option key={z} value={z}>
                  {ZONE_LABELS[z] ?? z}
                </option>
              ))}
            </select>
          </Field>
          {tri("serviceable", "Serviceable", filters.serviceable, "Serviceable", "Not serviceable")}
          {tri("cod", "COD", filters.cod, "COD allowed", "COD off")}
          <div className="flex items-end gap-2">
            <Button type="submit">Filter</Button>
            {hasFilters ? (
              <Button variant="ghost" asChild>
                <Link href="/admin/pincodes">Clear</Link>
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-admin-ink-muted" aria-live="polite" data-testid="pincode-count">
          {page.total === 0
            ? "No pincodes match."
            : `${fmt(from)}–${fmt(to)} of ${fmt(page.total)} ${page.total === 1 ? "pincode" : "pincodes"}`}
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href={`/admin/pincodes/export${pincodeQuery(filters)}`} download>
            <Download aria-hidden /> Download CSV{hasFilters ? " of this filter" : ""}
          </a>
        </Button>
      </div>

      {page.items.length === 0 ? (
        <EmptyState
          title="Nothing matches these filters"
          description="Try a shorter pincode or district, or clear a filter."
        />
      ) : (
        <PincodeTable rows={page.items} canEdit={canEdit} />
      )}

      {page.pageCount > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2 text-xs text-admin-ink-muted">
          <span>
            Page {fmt(page.page)} of {fmt(page.pageCount)}
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

      {canEdit ? (
        <>
          <BulkPincodeActions filter={filters} filterLabel={label} matched={page.total} />
          <PincodeCsvImport />
        </>
      ) : null}
    </div>
  );
}
