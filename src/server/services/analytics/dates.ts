/**
 * Date ranges and buckets for reports and insights. Everything is an Asia/Kolkata calendar day written
 * "YYYY-MM-DD" (the admin works in India time; IST has no DST, so arithmetic on the offset is exact).
 * Pure functions: no database, no clock except what is passed in.
 */
import { istDateString } from "@/server/domain/ist";

export type Bucket = "day" | "week";

export interface DateRange {
  /** First day, inclusive. */
  from: string;
  /** Last day, inclusive. */
  to: string;
}

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in "YYYY-MM-DD" form (rejects 2026-02-30). */
export function isIstDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return istDayOfUtcDate(d) === value;
}

function istDayOfUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Midnight (00:00 IST) at the start of `day`, as an instant. */
export function istDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  return istDayOfUtcDate(new Date(d.getTime() + n * DAY_MS));
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY_MS);
}

/** The IST day an instant falls in. */
export const istDayOf = istDateString;

/** Instants for a range: `start` inclusive, `end` exclusive (the start of the day after `to`). */
export function rangeBounds(range: DateRange): { start: Date; end: Date } {
  return { start: istDayStart(range.from), end: istDayStart(addDays(range.to, 1)) };
}

/** Number of days in the range, inclusive. */
export function rangeDays(range: DateRange): number {
  return diffDays(range.from, range.to) + 1;
}

/** Monday (ISO week start) on or before `day`. */
export function weekStart(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/** The bucket an instant belongs to: its IST day, or the Monday of its IST week. */
export function bucketKey(at: Date, bucket: Bucket): string {
  const day = istDateString(at);
  return bucket === "day" ? day : weekStart(day);
}

/** Every bucket key from the range's first to last day, in order (weeks are named by their Monday). */
export function enumerateBuckets(range: DateRange, bucket: Bucket): string[] {
  const keys: string[] = [];
  if (bucket === "day") {
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) keys.push(d);
    return keys;
  }
  for (let d = weekStart(range.from); d <= range.to; d = addDays(d, 7)) keys.push(d);
  return keys;
}

/** Rows keyed by bucket, with an empty row for every bucket that had no data. */
export function fillBuckets<T extends { bucket: string }>(
  range: DateRange,
  bucket: Bucket,
  rows: readonly T[],
  empty: (bucket: string) => T,
): T[] {
  const byKey = new Map(rows.map((r) => [r.bucket, r]));
  return enumerateBuckets(range, bucket).map((k) => byKey.get(k) ?? empty(k));
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Range from URL params (`from`, `to`), defaulting to the last 30 days ending today. Bad or reversed
 * input falls back to the default; ranges longer than a year are cut back to a year ending at `to`.
 */
export function parseDateRange(
  params: Record<string, string | string[] | undefined>,
  now: Date,
  defaultDays: number = DEFAULT_RANGE_DAYS,
): DateRange {
  const today = istDateString(now);
  const fallback: DateRange = { from: addDays(today, -(defaultDays - 1)), to: today };
  const rawFrom = one(params.from);
  const rawTo = one(params.to);
  const to = isIstDay(rawTo) ? rawTo : today;
  const from = isIstDay(rawFrom) ? rawFrom : isIstDay(rawTo) ? addDays(to, -(defaultDays - 1)) : fallback.from;
  if (from > to) return fallback;
  if (rangeDays({ from, to }) > MAX_RANGE_DAYS) return { from: addDays(to, -(MAX_RANGE_DAYS - 1)), to };
  return { from, to };
}
