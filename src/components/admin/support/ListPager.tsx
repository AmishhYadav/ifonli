import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/admin/ui";

/** "1–25 of 80" caption plus previous / next links (the hrefs are built on the server). */
export function ListPager({
  noun,
  total,
  page,
  pageCount,
  pageSize,
  prevHref,
  nextHref,
}: {
  noun: string;
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  prevHref: string;
  nextHref: string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-admin-ink-muted">
      <p aria-live="polite">{total === 0 ? `No ${noun}` : `${from}–${to} of ${total} ${noun}`}</p>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            asChild={page > 1}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            {page > 1 ? (
              <Link href={prevHref}>
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
              <Link href={nextHref}>
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
