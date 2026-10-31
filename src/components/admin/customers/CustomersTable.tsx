"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { formatDate } from "@/components/admin/orders/status";
import {
  Button,
  DataTable,
  Input,
  Select,
  dataTableColumns,
  type DataTableColumns,
} from "@/components/admin/ui";
import { formatINR } from "@/lib/money";
import type { CustomerKind, CustomerSort } from "@/server/services/admin/customers";

import { CustomerKindBadge } from "./CustomerKindBadge";

export interface CustomerRowView {
  ref: string;
  kind: CustomerKind;
  name: string;
  email: string;
  phone: string | null;
  joinedAt: string;
  orderCount: number;
  lifetimeValuePaise: number;
  lastOrderAt: string | null;
}

export interface CustomerFilterValues {
  q: string;
  /** "" = accounts and guests. */
  kind: "" | CustomerKind;
  sort: CustomerSort;
  dir: "asc" | "desc";
}

const ANY = "any";
const SORT_OPTIONS: { value: string; label: string; sort: CustomerSort; dir: "asc" | "desc" }[] = [
  { value: "last_order:desc", label: "Last order, newest first", sort: "last_order", dir: "desc" },
  { value: "last_order:asc", label: "Last order, oldest first", sort: "last_order", dir: "asc" },
  { value: "spent:desc", label: "Total spent, high to low", sort: "spent", dir: "desc" },
  { value: "spent:asc", label: "Total spent, low to high", sort: "spent", dir: "asc" },
  { value: "joined:desc", label: "Joined, newest first", sort: "joined", dir: "desc" },
  { value: "joined:asc", label: "Joined, oldest first", sort: "joined", dir: "asc" },
];

const col = dataTableColumns<CustomerRowView>();

function hrefFor(filters: CustomerFilterValues, page: number): string {
  const sp = new URLSearchParams();
  if (filters.q.trim()) sp.set("q", filters.q.trim());
  if (filters.kind) sp.set("kind", filters.kind);
  if (filters.sort !== "last_order" || filters.dir !== "desc") {
    sp.set("sort", filters.sort);
    sp.set("dir", filters.dir);
  }
  if (page > 1) sp.set("page", String(page));
  return `/admin/customers${sp.size ? `?${sp}` : ""}`;
}

export function CustomersTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  filters,
}: {
  rows: CustomerRowView[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  filters: CustomerFilterValues;
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(filters);
  // Re-sync when the URL changes (back/forward, clear).
  const key = JSON.stringify(filters);
  const [syncedKey, setSyncedKey] = React.useState(key);
  if (key !== syncedKey) {
    setSyncedKey(key);
    setDraft(filters);
  }

  function apply(next: CustomerFilterValues) {
    setDraft(next);
    router.push(hrefFor(next, 1));
  }
  const set = (patch: Partial<CustomerFilterValues>) => apply({ ...draft, ...patch });
  const hasFilters = Boolean(filters.q || filters.kind);

  const columns = React.useMemo<DataTableColumns<CustomerRowView>>(
    () =>
      col.columns([
        col.display({
          id: "customer",
          header: "Customer",
          cell: ({ row }) => (
            <Link href={`/admin/customers/${row.original.ref}`} className="block min-w-0">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-medium text-admin-ink">
                  {row.original.name || "No name"}
                </span>
                <CustomerKindBadge kind={row.original.kind} />
              </span>
              <span className="block truncate text-xs text-admin-ink-muted">
                {row.original.email}
              </span>
            </Link>
          ),
        }),
        col.display({
          id: "phone",
          header: "Phone",
          cell: ({ row }) => (
            <span className="text-admin-ink-muted">{row.original.phone ?? "-"}</span>
          ),
        }),
        col.display({ id: "orders", header: "Orders", cell: ({ row }) => row.original.orderCount }),
        col.display({
          id: "spent",
          header: "Total spent",
          cell: ({ row }) => formatINR(row.original.lifetimeValuePaise),
        }),
        col.display({
          id: "last",
          header: "Last order",
          cell: ({ row }) => (
            <span className="text-admin-ink-muted">
              {row.original.lastOrderAt ? formatDate(new Date(row.original.lastOrderAt)) : "Never"}
            </span>
          ),
        }),
        col.display({
          id: "joined",
          header: "Joined",
          cell: ({ row }) => (
            <span className="text-admin-ink-muted">
              {formatDate(new Date(row.original.joinedAt))}
            </span>
          ),
        }),
      ]),
    [],
  );

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const sortValue = `${draft.sort}:${draft.dir}`;

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
        role="search"
        aria-label="Filter customers"
      >
        <div className="relative w-full max-w-xs min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-admin-ink-faint"
            aria-hidden
          />
          <Input
            type="search"
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            placeholder="Name, e-mail or phone"
            aria-label="Search customers"
            className="pl-8"
          />
        </div>
        <Select
          aria-label="Customer type"
          value={draft.kind || ANY}
          onValueChange={(v) => set({ kind: v === ANY ? "" : (v as CustomerKind) })}
          className="h-9 w-44"
          options={[
            { value: ANY, label: "All customers" },
            { value: "account", label: "Accounts only" },
            { value: "guest", label: "Guests only" },
          ]}
        />
        <Select
          aria-label="Sort customers"
          value={sortValue}
          onValueChange={(v) => {
            const opt = SORT_OPTIONS.find((o) => o.value === v);
            if (opt) set({ sort: opt.sort, dir: opt.dir });
          }}
          className="h-9 w-56"
          options={SORT_OPTIONS.map(({ value, label }) => ({ value, label }))}
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
        {hasFilters ? (
          <Button variant="ghost" onClick={() => apply({ ...draft, q: "", kind: "" })}>
            <X aria-hidden /> Clear
          </Button>
        ) : null}
      </form>

      <p className="text-xs text-admin-ink-muted" aria-live="polite">
        {total === 0 ? "No customers" : `${from}–${to} of ${total} customers`}
      </p>

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.ref}
        pageSize={100}
        rightAligned={["orders", "spent"]}
        emptyMessage={
          hasFilters
            ? "No customers match this search."
            : "No customers yet. People appear here once they sign up or place an order."
        }
        onRowClick={(r) => router.push(`/admin/customers/${r.ref}`)}
      />

      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-1 text-xs text-admin-ink-muted">
          <Button
            variant="outline"
            size="icon-sm"
            asChild={page > 1}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            {page > 1 ? (
              <Link href={hrefFor(filters, page - 1)}>
                <ChevronLeft aria-hidden />
              </Link>
            ) : (
              <ChevronLeft aria-hidden />
            )}
          </Button>
          <span className="tabular px-2">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            asChild={page < pageCount}
            disabled={page >= pageCount}
            aria-label="Next page"
          >
            {page < pageCount ? (
              <Link href={hrefFor(filters, page + 1)}>
                <ChevronRight aria-hidden />
              </Link>
            ) : (
              <ChevronRight aria-hidden />
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
