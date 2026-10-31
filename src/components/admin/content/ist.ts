/**
 * Banner schedules are entered in Indian Standard Time (the store is India-only, and the admin's laptop
 * may be set to any zone). `datetime-local` inputs carry no zone, so they are read and written as IST.
 */

const IST_OFFSET = "+05:30";

/** `2026-11-01T10:30` (IST wall clock from a `datetime-local` input) -> ISO instant with offset. */
export function istLocalToIso(local: string): string | null {
  const v = local.trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) return v; // let the server reject it
  return `${v.length === 16 ? `${v}:00` : v}${IST_OFFSET}`;
}

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ISO instant -> `YYYY-MM-DDTHH:mm` in IST, for a `datetime-local` input. */
export function isoToIstLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const display = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function formatIst(iso: string | null | undefined): string {
  return iso ? `${display.format(new Date(iso))} IST` : "";
}
