"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { DataTable, dataTableColumns, type DataTableColumns } from "@/components/admin/ui";
import { formatDateTime } from "@/components/admin/orders/status";
import type { ContactStatus } from "@/server/domain/support-state";

import { ContactStatusBadge } from "./status";

export interface InboxRowView {
  id: string;
  name: string;
  email: string;
  orderRef: string | null;
  snippet: string;
  status: ContactStatus;
  assigneeName: string | null;
  createdAt: string;
}

const col = dataTableColumns<InboxRowView>();

export function InboxTable({ rows, emptyMessage }: { rows: InboxRowView[]; emptyMessage: string }) {
  const router = useRouter();
  const columns = React.useMemo<DataTableColumns<InboxRowView>>(
    () =>
      col.columns([
        col.display({
          id: "from",
          header: "From",
          cell: ({ row }) => (
            <Link href={`/admin/support/messages/${row.original.id}`} className="block min-w-0">
              <span className="block truncate font-medium text-admin-ink">{row.original.name}</span>
              <span className="block truncate text-xs text-admin-ink-muted">
                {row.original.email}
              </span>
            </Link>
          ),
        }),
        col.display({
          id: "message",
          header: "Message",
          cell: ({ row }) => (
            <span className="block max-w-md min-w-0">
              <span className="line-clamp-2 text-[13px] text-admin-ink">
                {row.original.snippet}
              </span>
              {row.original.orderRef ? (
                <span className="font-mono text-xs text-admin-ink-muted">
                  Order {row.original.orderRef}
                </span>
              ) : null}
            </span>
          ),
        }),
        col.display({
          id: "status",
          header: "Status",
          cell: ({ row }) => <ContactStatusBadge status={row.original.status} />,
        }),
        col.display({
          id: "assignee",
          header: "Assigned",
          cell: ({ row }) =>
            row.original.assigneeName ? (
              <span className="text-[13px]">{row.original.assigneeName}</span>
            ) : (
              <span className="text-[13px] text-admin-ink-muted">Unassigned</span>
            ),
        }),
        col.display({
          id: "received",
          header: "Received",
          cell: ({ row }) => (
            <span className="text-xs whitespace-nowrap text-admin-ink-muted">
              {formatDateTime(new Date(row.original.createdAt))}
            </span>
          ),
        }),
      ]),
    [],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      pageSize={100}
      emptyMessage={emptyMessage}
      onRowClick={(r) => router.push(`/admin/support/messages/${r.id}`)}
    />
  );
}
