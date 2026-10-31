"use client";

import { Camera } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { DataTable, dataTableColumns, type DataTableColumns } from "@/components/admin/ui";
import { formatDateTime } from "@/components/admin/orders/status";
import type { SupportResolution, SupportStatus, SupportType } from "@/server/domain/support-state";

import { CaseStatusBadge, CaseTypeBadge, ResolutionBadge } from "./status";

export interface CaseRowView {
  id: string;
  shortId: string;
  orderRef: string;
  customerName: string;
  email: string;
  type: SupportType;
  status: SupportStatus;
  resolution: SupportResolution | null;
  snippet: string;
  photoCount: number;
  assigneeName: string | null;
  createdAt: string;
}

const col = dataTableColumns<CaseRowView>();

export function CasesTable({ rows, emptyMessage }: { rows: CaseRowView[]; emptyMessage: string }) {
  const router = useRouter();
  const columns = React.useMemo<DataTableColumns<CaseRowView>>(
    () =>
      col.columns([
        col.display({
          id: "case",
          header: "Case",
          cell: ({ row }) => (
            <Link href={`/admin/support/cases/${row.original.id}`} className="block min-w-0">
              <span className="block font-mono text-[13px] font-medium text-admin-ink">
                {row.original.shortId}
              </span>
              <span className="block text-xs text-admin-ink-muted">
                {formatDateTime(new Date(row.original.createdAt))}
              </span>
            </Link>
          ),
        }),
        col.display({
          id: "order",
          header: "Order and customer",
          cell: ({ row }) => (
            <span className="block min-w-0">
              <span className="block font-mono text-[13px] text-admin-ink">
                {row.original.orderRef}
              </span>
              <span className="block truncate text-xs text-admin-ink-muted">
                {row.original.customerName || row.original.email}
              </span>
            </span>
          ),
        }),
        col.display({
          id: "problem",
          header: "Problem",
          cell: ({ row }) => (
            <span className="block max-w-sm min-w-0">
              <span className="flex items-center gap-1.5">
                <CaseTypeBadge type={row.original.type} />
                {row.original.photoCount > 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-xs text-admin-ink-muted">
                    <Camera className="size-3" aria-hidden />
                    {row.original.photoCount}
                    <span className="sr-only"> photos</span>
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 line-clamp-2 text-[13px] text-admin-ink">
                {row.original.snippet}
              </span>
            </span>
          ),
        }),
        col.display({
          id: "status",
          header: "Status",
          cell: ({ row }) => (
            <span className="flex flex-wrap items-center gap-1">
              <CaseStatusBadge status={row.original.status} />
              {row.original.resolution && row.original.resolution !== "rejected" ? (
                <ResolutionBadge resolution={row.original.resolution} />
              ) : null}
            </span>
          ),
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
      onRowClick={(r) => router.push(`/admin/support/cases/${r.id}`)}
    />
  );
}
