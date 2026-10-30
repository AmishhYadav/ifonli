"use client";

import { Package, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Select,
  dataTableColumns,
  type DataTableColumns,
} from "@/components/admin/ui";
import { formatINR } from "@/lib/money";
import type { StockState } from "@/server/services/admin/products";

export interface ProductRowView {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "active" | "archived";
  typeName: string;
  isKit: boolean;
  vibeNames: string[];
  variantCount: number;
  priceFromPaise: number | null;
  priceToPaise: number | null;
  available: number;
  stock: StockState;
  imageUrl: string | null;
  imageAlt: string;
  updatedAt: string;
}

const STATUS_TONE = { active: "success", draft: "neutral", archived: "warning" } as const;
const STOCK_TONE = { in: "success", low: "warning", out: "danger" } as const;
const STOCK_LABEL = { in: "In stock", low: "Low stock", out: "Out of stock" } as const;

const col = dataTableColumns<ProductRowView>();

const columns: DataTableColumns<ProductRowView> = col.columns([
  col.accessor("name", {
    id: "name",
    header: "Product",
    sortFn: "text",
    cell: ({ row }) => {
      const p = row.original;
      return (
        <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3">
          <span className="relative size-10 shrink-0 overflow-hidden rounded-md border border-admin-border bg-admin-surface-2">
            {p.imageUrl ? (
              <Image
                src={p.imageUrl}
                alt={p.imageAlt}
                fill
                sizes="40px"
                className="object-contain"
                unoptimized
              />
            ) : null}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-admin-ink">{p.name}</span>
            <span className="block truncate text-xs text-admin-ink-muted">/{p.slug}</span>
          </span>
        </Link>
      );
    },
  }),
  col.accessor("typeName", {
    id: "type",
    header: "Type",
    sortFn: "text",
    cell: (c) => c.getValue(),
  }),
  col.accessor((r) => r.vibeNames.join(", "), {
    id: "vibes",
    header: "Vibes",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.vibeNames.length ? (
        <span className="flex flex-wrap gap-1">
          {row.original.vibeNames.map((v) => (
            <Badge key={v}>{v}</Badge>
          ))}
        </span>
      ) : (
        <span className="text-admin-ink-faint">None</span>
      ),
  }),
  col.accessor("status", {
    id: "status",
    header: "Status",
    sortFn: "text",
    cell: ({ row }) => (
      <span className="flex flex-wrap gap-1">
        <Badge tone={STATUS_TONE[row.original.status]} className="capitalize">
          {row.original.status}
        </Badge>
        {row.original.isKit ? <Badge tone="primary">Kit</Badge> : null}
      </span>
    ),
  }),
  col.accessor("variantCount", {
    id: "variants",
    header: "Variants",
    sortFn: "basic",
    cell: (c) => c.getValue(),
  }),
  col.accessor((r) => r.priceFromPaise ?? 0, {
    id: "price",
    header: "Price",
    sortFn: "basic",
    cell: ({ row }) => {
      const { priceFromPaise: a, priceToPaise: b } = row.original;
      if (a === null || b === null) return "—";
      return a === b ? formatINR(a) : `${formatINR(a)} – ${formatINR(b)}`;
    },
  }),
  col.accessor("available", {
    id: "stock",
    header: "Stock",
    sortFn: "basic",
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        <Badge tone={STOCK_TONE[row.original.stock]}>{STOCK_LABEL[row.original.stock]}</Badge>
        <span className="tabular text-xs text-admin-ink-muted">{row.original.available}</span>
      </span>
    ),
  }),
  col.accessor("updatedAt", {
    id: "updated",
    header: "Updated",
    sortFn: "text",
    cell: ({ row }) => (
      <time dateTime={row.original.updatedAt} className="text-xs text-admin-ink-muted">
        {new Date(row.original.updatedAt).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        })}
      </time>
    ),
  }),
]);

const ALL = "all";

export function ProductsTable({
  rows,
  filters,
  options,
  canCreate,
}: {
  rows: ProductRowView[];
  filters: { vibe?: string; type?: string; status?: string; stock?: string };
  options: { vibes: { slug: string; name: string }[]; types: { slug: string; name: string }[] };
  canCreate: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  // "vibe" is reserved: the storefront theme sync keeps ?vibe= on every URL, so the vibe filter is ?collection=.
  const PARAM: Record<string, string> = { vibe: "collection" };
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    const name = PARAM[key] ?? key;
    if (value === ALL) next.delete(name);
    else next.set(name, value);
    router.replace(`/admin/products${next.size ? `?${next}` : ""}`);
  }

  const filterSelect = (
    key: keyof typeof filters,
    label: string,
    items: { value: string; label: string }[],
  ) => (
    <Select
      aria-label={label}
      value={filters[key] ?? ALL}
      onValueChange={(v) => setFilter(key, v)}
      options={[{ value: ALL, label: `All ${label.toLowerCase()}` }, ...items]}
      className="h-9 w-36"
    />
  );

  const toolbar = (
    <>
      {filterSelect(
        "vibe",
        "Vibes",
        options.vibes.map((v) => ({ value: v.slug, label: v.name })),
      )}
      {filterSelect(
        "type",
        "Types",
        options.types.map((t) => ({ value: t.slug, label: t.name })),
      )}
      {filterSelect("status", "Statuses", [
        { value: "active", label: "Active" },
        { value: "draft", label: "Draft" },
        { value: "archived", label: "Archived" },
      ])}
      {filterSelect("stock", "Stock", [
        { value: "in", label: "In stock" },
        { value: "low", label: "Low stock" },
        { value: "out", label: "Out of stock" },
      ])}
    </>
  );

  const filtered = Object.values(filters).some(Boolean);
  if (rows.length === 0 && !filtered) {
    return (
      <EmptyState
        icon={<Package />}
        title="No products yet"
        description="Create the first product to start building the catalogue."
        action={
          canCreate ? (
            <Button asChild>
              <Link href="/admin/products/new">
                <Plus aria-hidden /> New product
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      searchText={(r) => `${r.name} ${r.slug} ${r.typeName} ${r.vibeNames.join(" ")}`}
      searchPlaceholder="Search products"
      toolbar={toolbar}
      rightAligned={["price"]}
      emptyMessage="No products match these filters."
      caption={(visible, total) =>
        visible === total ? `${total} products` : `${visible} of ${total} products`
      }
    />
  );
}
