import Link from "next/link";
import type { ReactNode } from "react";

import { Button, inputClasses } from "@/components/admin/ui";
import { addDays, type DateRange } from "@/server/services/analytics/dates";

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

/**
 * Date-range picker as a plain GET form (works without client JS and keeps the range in the URL, so it can
 * be shared and bookmarked). `extra` carries more controls that belong to the same form; `keep` re-sends
 * params that should survive a change of range.
 */
export function DateRangeForm({
  action,
  range,
  today,
  keep = {},
  linkOnly = {},
  extra,
}: {
  action: string;
  range: DateRange;
  /** Today in India time, "YYYY-MM-DD": the upper bound and the end of the presets. */
  today: string;
  keep?: Record<string, string>;
  /** Extra params for the preset links only (a control in `extra` already carries them in the form). */
  linkOnly?: Record<string, string>;
  extra?: ReactNode;
}) {
  const presetHref = (days: number) => {
    const sp = new URLSearchParams({ ...keep, ...linkOnly, from: addDays(today, -(days - 1)), to: today });
    return `${action}?${sp}`;
  };
  return (
    <form method="get" action={action} className="mb-5 flex flex-wrap items-end gap-3" aria-label="Date range">
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="flex flex-col gap-1">
        <label htmlFor="range-from" className="text-xs text-admin-ink-muted">
          From
        </label>
        <input id="range-from" type="date" name="from" defaultValue={range.from} max={today} required className={`${inputClasses} w-40`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="range-to" className="text-xs text-admin-ink-muted">
          To
        </label>
        <input id="range-to" type="date" name="to" defaultValue={range.to} max={today} required className={`${inputClasses} w-40`} />
      </div>
      {extra}
      <Button type="submit" variant="secondary">
        Apply
      </Button>
      <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-admin-ink-muted">
        {PRESETS.map((p) => (
          <Link key={p.days} href={presetHref(p.days)} className="text-admin-primary hover:underline">
            {p.label}
          </Link>
        ))}
        <span>India time (IST)</span>
      </p>
    </form>
  );
}
