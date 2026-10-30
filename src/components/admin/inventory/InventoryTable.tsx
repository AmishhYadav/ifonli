"use client";

import { Download, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { adjustStockAction } from "@/app/admin/(app)/inventory/actions";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Textarea,
  buttonVariants,
  cn,
  dataTableColumns,
  type DataTableColumns,
} from "@/components/admin/ui";
import type { InventoryFilter, InventoryRow } from "@/server/services/admin/inventory";

const STATE_TONE = { in: "success", low: "warning", out: "danger" } as const;
const STATE_LABEL = { in: "In stock", low: "Low stock", out: "Out of stock" } as const;

const REASONS = [
  { value: "restock", label: "Restock (new stock arrived)" },
  { value: "return_restock", label: "Return restock" },
  { value: "adjust", label: "Adjustment (count changed)" },
  { value: "correction", label: "Correction (data fix)" },
];

function AdjustDialog({ row, onClose }: { row: InventoryRow | null; onClose: () => void }) {
  const router = useRouter();
  const [delta, setDelta] = React.useState("");
  const [reason, setReason] = React.useState("restock");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  if (!row) return null;

  const parsed = /^[+-]?\d+$/.test(delta.trim()) ? Number(delta.trim()) : null;
  const after = parsed === null ? null : row.onHand + parsed;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!row || parsed === null) return;
    setError(null);
    startTransition(async () => {
      const res = await adjustStockAction({
        variantId: row.variantId,
        delta: parsed,
        reason,
        note,
      });
      if (!res.ok) {
        setError(res.fieldErrors?.note ?? res.error);
        return;
      }
      toast.success(`${row.sku}: ${res.data.previousQty} to ${res.data.newQty}`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
            <DialogDescription>
              {row.productName} · {row.variantTitle} · <span className="font-mono">{row.sku}</span>
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Change (units)"
            htmlFor="adj-delta"
            required
            hint={
              after === null
                ? `On hand now: ${row.onHand}. Use + to add and − to remove, for example 12 or -3.`
                : `On hand: ${row.onHand} → ${after}${after < 0 ? " (not allowed: below zero)" : ""}`
            }
          >
            <Input
              id="adj-delta"
              inputMode="numeric"
              autoFocus
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              className="tabular"
            />
          </Field>
          <Field label="Reason" htmlFor="adj-reason" required>
            <Select id="adj-reason" value={reason} onValueChange={setReason} options={REASONS} />
          </Field>
          <Field
            label="Note"
            htmlFor="adj-note"
            required={reason === "adjust" || reason === "correction"}
            error={error ?? undefined}
          >
            <Textarea
              id="adj-note"
              rows={2}
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={pending}
              disabled={parsed === null || parsed === 0 || (after ?? 0) < 0}
            >
              Save change
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const col = dataTableColumns<InventoryRow>();

export function InventoryTable({
  rows,
  filter,
  canAdjust,
}: {
  rows: InventoryRow[];
  filter: InventoryFilter;
  canAdjust: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [adjusting, setAdjusting] = React.useState<InventoryRow | null>(null);

  const columns = React.useMemo<DataTableColumns<InventoryRow>>(
    () =>
      col.columns([
        col.accessor("productName", {
          id: "product",
          header: "Product",
          sortFn: "text",
          cell: ({ row }) => (
            <Link href={`/admin/products/${row.original.productId}`} className="block min-w-0">
              <span className="block truncate font-medium text-admin-ink">
                {row.original.productName}
              </span>
              <span className="block truncate text-xs text-admin-ink-muted">
                {row.original.variantTitle !== "Default" ? `${row.original.variantTitle} · ` : ""}
                <span className="font-mono">{row.original.sku}</span>
                {row.original.active ? "" : " · inactive"}
              </span>
            </Link>
          ),
        }),
        col.accessor("onHand", {
          id: "onHand",
          header: "On hand",
          sortFn: "basic",
          cell: (c) => c.getValue(),
        }),
        col.accessor("reserved", {
          id: "reserved",
          header: "Reserved",
          sortFn: "basic",
          cell: (c) => c.getValue(),
        }),
        col.accessor("available", {
          id: "available",
          header: "Available",
          sortFn: "basic",
          cell: (c) => c.getValue(),
        }),
        col.accessor("state", {
          id: "state",
          header: "State",
          sortFn: "text",
          cell: ({ row }) => (
            <Badge tone={STATE_TONE[row.original.state]}>{STATE_LABEL[row.original.state]}</Badge>
          ),
        }),
        col.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          cell: ({ row }) =>
            canAdjust ? (
              <Button variant="outline" size="sm" onClick={() => setAdjusting(row.original)}>
                <SlidersHorizontal aria-hidden /> Adjust
              </Button>
            ) : null,
        }),
      ]),
    [canAdjust],
  );

  function setFilter(next: string) {
    const sp = new URLSearchParams(params.toString());
    if (next === "all") sp.delete("filter");
    else sp.set("filter", next);
    router.replace(`/admin/inventory${sp.size ? `?${sp}` : ""}`);
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.variantId}
        searchText={(r) => `${r.productName} ${r.variantTitle} ${r.sku}`}
        searchPlaceholder="Search product or SKU"
        rightAligned={["onHand", "reserved", "available"]}
        pageSize={50}
        emptyMessage="No variants match."
        toolbar={
          <>
            <Select
              aria-label="Stock filter"
              value={filter}
              onValueChange={setFilter}
              className="h-9 w-40"
              options={[
                { value: "all", label: "All stock" },
                { value: "low", label: "Low stock" },
                { value: "out", label: "Out of stock" },
              ]}
            />
            <a
              href={`/admin/inventory/export${filter === "all" ? "" : `?filter=${filter}`}`}
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
              download
            >
              <Download aria-hidden /> Export CSV
            </a>
          </>
        }
        caption={(visible, total) =>
          visible === total ? `${total} variants` : `${visible} of ${total} variants`
        }
      />
      <AdjustDialog
        key={adjusting?.variantId ?? "none"}
        row={adjusting}
        onClose={() => setAdjusting(null)}
      />
    </>
  );
}
