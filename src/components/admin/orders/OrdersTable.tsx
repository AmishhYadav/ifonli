"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import {
  Button,
  DataTable,
  Input,
  Select,
  dataTableColumns,
  type DataTableColumns,
} from "@/components/admin/ui";
import { formatINR } from "@/lib/money";
import type { FulfillmentStatus, OrderStatus, PaymentStatus } from "@/server/domain/order-state";
import type { PaymentMethod } from "@/server/domain/types";
import {
  FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
} from "@/server/domain/order-state";

import { FulfilmentBadge, MethodBadge, OrderStatusBadge, PaymentStatusBadge, formatDateTime, statusWords } from "./status";

export interface OrderRowView {
  id: string;
  ref: string;
  placedAt: string;
  customerName: string;
  email: string;
  phone: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  paymentMethod: PaymentMethod;
  totalPaise: number;
  itemCount: number;
}

export interface OrderFilterValues {
  status: string;
  payment: string;
  fulfilment: string;
  method: string;
  from: string;
  to: string;
  q: string;
}

const ANY = "any";
const opts = (label: string, values: readonly string[]) => [
  { value: ANY, label },
  ...values.map((v) => ({ value: v, label: statusWords(v) })),
];

const col = dataTableColumns<OrderRowView>();

function hrefFor(filters: OrderFilterValues, page: number): string {
  const sp = new URLSearchParams();
  const map: [string, string][] = [
    ["status", filters.status],
    ["payment", filters.payment],
    ["fulfilment", filters.fulfilment],
    ["method", filters.method],
    ["from", filters.from],
    ["to", filters.to],
    ["q", filters.q.trim()],
  ];
  for (const [k, v] of map) if (v) sp.set(k, v);
  if (page > 1) sp.set("page", String(page));
  return `/admin/orders${sp.size ? `?${sp}` : ""}`;
}

export function OrdersTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  filters,
}: {
  rows: OrderRowView[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  filters: OrderFilterValues;
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

  function apply(next: OrderFilterValues) {
    setDraft(next);
    router.push(hrefFor(next, 1));
  }
  const set = (patch: Partial<OrderFilterValues>) => apply({ ...draft, ...patch });
  const hasFilters = Object.values(filters).some(Boolean);

  const columns = React.useMemo<DataTableColumns<OrderRowView>>(
    () =>
      col.columns([
        col.accessor("ref", {
          id: "order",
          header: "Order",
          cell: ({ row }) => (
            <Link href={`/admin/orders/${row.original.id}`} className="block min-w-0">
              <span className="block font-mono text-[13px] font-medium text-admin-ink">{row.original.ref}</span>
              <span className="block text-xs text-admin-ink-muted">{formatDateTime(new Date(row.original.placedAt))}</span>
            </Link>
          ),
        }),
        col.display({
          id: "customer",
          header: "Customer",
          cell: ({ row }) => (
            <span className="block min-w-0">
              <span className="block truncate text-admin-ink">{row.original.customerName || "-"}</span>
              <span className="block truncate text-xs text-admin-ink-muted">{row.original.email}</span>
            </span>
          ),
        }),
        col.display({
          id: "payment",
          header: "Payment",
          cell: ({ row }) => (
            <span className="flex flex-wrap items-center gap-1">
              <MethodBadge method={row.original.paymentMethod} />
              <PaymentStatusBadge status={row.original.paymentStatus} />
            </span>
          ),
        }),
        col.display({
          id: "fulfilment",
          header: "Status",
          cell: ({ row }) => (
            <span className="flex flex-wrap items-center gap-1">
              <OrderStatusBadge status={row.original.status} />
              <FulfilmentBadge status={row.original.fulfillmentStatus} />
            </span>
          ),
        }),
        col.accessor("itemCount", { id: "items", header: "Items", cell: (c) => c.getValue() }),
        col.accessor("totalPaise", {
          id: "total",
          header: "Total",
          cell: (c) => formatINR(c.getValue()),
        }),
      ]),
    [],
  );

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
        role="search"
        aria-label="Filter orders"
      >
        <div className="relative w-full max-w-xs min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-admin-ink-faint" aria-hidden />
          <Input
            type="search"
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            placeholder="Order, e-mail, phone or name"
            aria-label="Search orders"
            className="pl-8"
          />
        </div>
        <Select
          aria-label="Order status"
          value={draft.status || ANY}
          onValueChange={(v) => set({ status: v === ANY ? "" : v })}
          className="h-9 w-40"
          options={opts("Any order status", ORDER_STATUSES)}
        />
        <Select
          aria-label="Payment status"
          value={draft.payment || ANY}
          onValueChange={(v) => set({ payment: v === ANY ? "" : v })}
          className="h-9 w-44"
          options={opts("Any payment status", PAYMENT_STATUSES)}
        />
        <Select
          aria-label="Fulfilment status"
          value={draft.fulfilment || ANY}
          onValueChange={(v) => set({ fulfilment: v === ANY ? "" : v })}
          className="h-9 w-44"
          options={opts("Any fulfilment", FULFILLMENT_STATUSES)}
        />
        <Select
          aria-label="Payment method"
          value={draft.method || ANY}
          onValueChange={(v) => set({ method: v === ANY ? "" : v })}
          className="h-9 w-36"
          options={[
            { value: ANY, label: "Any method" },
            { value: "razorpay", label: "Online" },
            { value: "cod", label: "COD" },
          ]}
        />
        <label className="flex items-center gap-1.5 text-xs text-admin-ink-muted">
          From
          <Input type="date" value={draft.from} onChange={(e) => set({ from: e.target.value })} className="h-9 w-36" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-admin-ink-muted">
          To
          <Input type="date" value={draft.to} onChange={(e) => set({ to: e.target.value })} className="h-9 w-36" />
        </label>
        <Button type="submit" variant="outline">
          Search
        </Button>
        {hasFilters ? (
          <Button
            variant="ghost"
            onClick={() => apply({ status: "", payment: "", fulfilment: "", method: "", from: "", to: "", q: "" })}
          >
            <X aria-hidden /> Clear
          </Button>
        ) : null}
      </form>

      <p className="text-xs text-admin-ink-muted" aria-live="polite">
        {total === 0 ? "No orders" : `${from}–${to} of ${total} orders`}
      </p>

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        pageSize={100}
        rightAligned={["total"]}
        emptyMessage={hasFilters ? "No orders match these filters." : "No orders yet."}
        onRowClick={(r) => router.push(`/admin/orders/${r.id}`)}
      />

      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-1 text-xs text-admin-ink-muted">
          <Button variant="outline" size="icon-sm" asChild={page > 1} disabled={page <= 1} aria-label="Previous page">
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
          <Button variant="outline" size="icon-sm" asChild={page < pageCount} disabled={page >= pageCount} aria-label="Next page">
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
