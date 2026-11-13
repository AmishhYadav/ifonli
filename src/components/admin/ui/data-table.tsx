"use client";

import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import * as React from "react";

import { Button } from "./button";
import { cn } from "./cn";
import { Input } from "./input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

/** Client-side sorting + pagination (search is applied by `DataTable` before the table sees rows). */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, basic: sortFn_basic },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumns<T extends RowData> = ColumnDef<DataTableFeatures, T>[];

/** `const col = dataTableColumns<Row>(); const columns = col.columns([col.accessor("name", {...})])` */
export function dataTableColumns<T extends RowData>() {
  return createColumnHelper<DataTableFeatures, T>();
}

export interface DataTableProps<T extends RowData> {
  columns: DataTableColumns<T>;
  data: T[];
  /** Stable row identity (used as React key and for row-click handlers). */
  getRowId: (row: T) => string;
  /** Text matched by the search box; omit to hide the search box. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** Extra controls (filters, buttons) shown beside the search box. */
  toolbar?: React.ReactNode;
  pageSize?: number;
  /** Column ids whose header and cells are right-aligned (numbers, money). */
  rightAligned?: readonly string[];
  emptyMessage?: React.ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
  /** Called whenever the visible (searched) row count changes; used for a "n results" label. */
  caption?: (visible: number, total: number) => React.ReactNode;
}

const EMPTY: never[] = [];

export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  searchText,
  searchPlaceholder = "Search…",
  toolbar,
  pageSize = 25,
  rightAligned = EMPTY,
  emptyMessage = "Nothing to show.",
  onRowClick,
  className,
  caption,
}: DataTableProps<T>) {
  const [query, setQuery] = React.useState("");
  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !searchText) return data;
    return data.filter((row) => searchText(row).toLowerCase().includes(q));
  }, [data, query, searchText]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId,
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  const { pageIndex } = table.state.pagination;
  const pageCount = table.getPageCount();
  const total = rows.length;
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {searchText || toolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          {searchText ? (
            <div className="relative w-full max-w-xs min-w-48 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-admin-ink-faint"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="pl-9"
              />
            </div>
          ) : null}
          {toolbar}
          {caption ? (
            <span className="ml-auto text-xs text-admin-ink-muted">
              {caption(rows.length, data.length)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-admin-border bg-admin-surface shadow-sm">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const right = rightAligned.includes(header.column.id);
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <TableHead
                      key={header.id}
                      className={right ? "text-right" : undefined}
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-admin-ink",
                            right && "flex-row-reverse",
                          )}
                        >
                          <table.FlexRender header={header} />
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3" aria-hidden />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3" aria-hidden />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="h-28 text-center text-admin-ink-muted"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={onRowClick ? "cursor-pointer" : undefined}
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={
                        rightAligned.includes(cell.column.id) ? "tabular text-right" : undefined
                      }
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2 text-xs text-admin-ink-muted">
          <span>
            {from}–{to} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span className="tabular px-2">
              Page {pageIndex + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
