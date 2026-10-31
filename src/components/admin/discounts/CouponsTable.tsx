"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { setCouponActiveAction } from "@/app/admin/(app)/discounts/actions";
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  dataTableColumns,
  type DataTableColumns,
} from "@/components/admin/ui";
import { formatINR } from "@/lib/money";
import type { CouponKind, CouponState, CouponStats } from "@/server/services/admin/discounts";

export interface CouponRowView {
  id: string;
  code: string;
  kind: CouponKind;
  value: number;
  minSubtotalPaise: number;
  maxDiscountPaise: number | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  active: boolean;
  state: CouponState;
  stats: CouponStats;
  scoped: boolean;
}

const STATE_TONE = { active: "success", scheduled: "info", expired: "neutral", exhausted: "warning", inactive: "neutral" } as const;
const STATE_LABEL = { active: "Active", scheduled: "Scheduled", expired: "Expired", exhausted: "Fully claimed", inactive: "Inactive" } as const;

export function CouponStateBadge({ state }: { state: CouponState }) {
  return <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>;
}

const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

function describe(c: CouponRowView): string {
  const bp = c.value / 100;
  const base = c.kind === "percent" ? `${Number.isInteger(bp) ? bp : bp.toFixed(2)}% off` : c.kind === "fixed" ? `${formatINR(c.value)} off` : "Free shipping";
  const bits = [base];
  if (c.maxDiscountPaise !== null) bits.push(`up to ${formatINR(c.maxDiscountPaise)}`);
  if (c.minSubtotalPaise > 0) bits.push(`min ${formatINR(c.minSubtotalPaise)}`);
  return bits.join(" · ");
}

function validity(c: CouponRowView): string {
  if (!c.startsAt && !c.endsAt) return "Always";
  const s = c.startsAt ? date.format(new Date(c.startsAt)) : "now";
  const e = c.endsAt ? date.format(new Date(c.endsAt)) : "no end";
  return `${s} to ${e}`;
}

const col = dataTableColumns<CouponRowView>();

export function CouponsTable({ rows, canManage }: { rows: CouponRowView[]; canManage: boolean }) {
  const router = useRouter();
  const [target, setTarget] = React.useState<CouponRowView | null>(null);

  const columns = React.useMemo<DataTableColumns<CouponRowView>>(
    () =>
      col.columns([
        col.accessor("code", {
          id: "code",
          header: "Code",
          sortFn: "text",
          cell: ({ row }) => (
            <Link href={`/admin/discounts/${row.original.id}`} className="block min-w-0">
              <span className="block font-mono text-[13px] font-semibold text-admin-ink">{row.original.code}</span>
              <span className="block text-xs text-admin-ink-muted">{describe(row.original)}</span>
            </Link>
          ),
        }),
        col.display({
          id: "validity",
          header: "Valid",
          cell: ({ row }) => (
            <span className="text-[13px]">
              {validity(row.original)}
              {row.original.scoped ? <span className="block text-xs text-admin-ink-muted">Limited to some items</span> : null}
            </span>
          ),
        }),
        col.accessor((r) => r.stats.confirmed, {
          id: "used",
          header: "Used",
          sortFn: "basic",
          cell: ({ row }) => (
            <span className="tabular text-[13px]">
              {row.original.stats.confirmed}
              {row.original.usageLimit !== null ? ` / ${row.original.usageLimit}` : ""}
              {row.original.stats.reserved > 0 ? (
                <span className="block text-xs text-admin-ink-muted">{row.original.stats.reserved} in checkout</span>
              ) : null}
            </span>
          ),
        }),
        col.accessor((r) => r.stats.revenuePaise, {
          id: "revenue",
          header: "Order value",
          sortFn: "basic",
          cell: ({ row }) => formatINR(row.original.stats.revenuePaise),
        }),
        col.accessor((r) => r.stats.discountPaise, {
          id: "discount",
          header: "Discount given",
          sortFn: "basic",
          cell: ({ row }) => formatINR(row.original.stats.discountPaise),
        }),
        col.accessor("state", {
          id: "state",
          header: "Status",
          sortFn: "text",
          cell: ({ row }) => <CouponStateBadge state={row.original.state} />,
        }),
        col.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          cell: ({ row }) =>
            canManage ? (
              <Button
                variant={row.original.active ? "ghost" : "outline"}
                size="sm"
                onClick={() => setTarget(row.original)}
              >
                {row.original.active ? "Deactivate" : "Activate"}
              </Button>
            ) : null,
        }),
      ]),
    [canManage],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        searchText={(r) => r.code}
        searchPlaceholder="Search codes"
        rightAligned={["revenue", "discount"]}
        pageSize={50}
        emptyMessage="No coupons yet."
        caption={(visible, total) => (visible === total ? `${total} coupons` : `${visible} of ${total} coupons`)}
      />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={target?.active ? `Deactivate ${target.code}?` : `Activate ${target?.code ?? ""}?`}
        description={
          target?.active
            ? "The code stops working straight away. Orders that already hold it keep their discount."
            : "Customers can use the code again, within its dates and limits."
        }
        confirmLabel={target?.active ? "Deactivate" : "Activate"}
        destructive={target?.active}
        onConfirm={async () => {
          if (!target) return;
          const res = await setCouponActiveAction(target.id, !target.active);
          if (!res.ok) {
            toast.error(res.error);
            throw new Error(res.error);
          }
          toast.success(`${target.code} ${target.active ? "deactivated" : "activated"}`);
          router.refresh();
        }}
      />
    </>
  );
}
