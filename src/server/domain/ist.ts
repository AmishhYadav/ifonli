/**
 * Asia/Kolkata calendar helpers. India has no DST and a fixed UTC+05:30 offset, so plain offset
 * arithmetic is exact and does not depend on the runtime's ICU data.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface IstParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

/** Calendar parts of `date` as seen on a wall clock in India. */
export function istParts(date: Date): IstParts {
  const t = date.getTime();
  if (!Number.isFinite(t)) {
    throw new RangeError("Invalid Date");
  }
  const shifted = new Date(t + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** "1 Nov 2026", the calendar date in Asia/Kolkata. */
export function formatIstDate(date: Date): string {
  const p = istParts(date);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** "2026-11-01", the calendar date in Asia/Kolkata. */
export function istDateString(date: Date): string {
  const p = istParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "26 Nov 2026, 3:42 pm IST": date and wall-clock time in Asia/Kolkata (used in security e-mails). */
export function formatIstDateTime(date: Date): string {
  const t = date.getTime();
  if (!Number.isFinite(t)) {
    throw new RangeError("Invalid Date");
  }
  const shifted = new Date(t + IST_OFFSET_MS);
  const hour24 = shifted.getUTCHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${formatIstDate(date)}, ${hour12}:${minute} ${hour24 < 12 ? "am" : "pm"} IST`;
}
