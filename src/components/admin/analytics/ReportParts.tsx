import { Download } from "lucide-react";
import type { ReactNode } from "react";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@/components/admin/ui";

/** A titled card with an optional CSV export link in its header. */
export function ReportCard({
  title,
  description,
  exportHref,
  children,
  className,
  id,
}: {
  title: string;
  description?: ReactNode;
  exportHref?: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <Card className={className} id={id} role="region" aria-label={title}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
        </div>
        {exportHref ? (
          <Button asChild variant="outline" size="sm">
            <a href={exportHref} download>
              <Download aria-hidden />
              Export CSV
              <span className="sr-only"> of {title}</span>
            </a>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-align numbers. */
  numeric?: boolean;
}

/** Plain, semantic table for report rows, with an empty message. */
export function SimpleTable<T>({
  columns,
  rows,
  rowKey,
  empty = "Nothing in this range.",
  caption,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  empty?: string;
  caption?: string;
}) {
  if (rows.length === 0) return <p className="py-4 text-center text-[13px] text-admin-ink-muted">{empty}</p>;
  return (
    <Table>
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((c) => (
            <TableHead key={c.header} className={cn(c.numeric && "text-right")}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((c) => (
              <TableCell key={c.header} className={cn(c.numeric && "tabular text-right")}>
                {c.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
