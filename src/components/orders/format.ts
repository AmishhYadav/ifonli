/** Display helpers shared by checkout, the order page and tracking. India dates, 12-hour times. */

const DAY_MONTH = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

/** "5 Nov to 8 Nov" from two India calendar dates ("YYYY-MM-DD"); a single date when they match. */
export function formatDateRange(fromDate: string, toDate: string): string {
  const from = DAY_MONTH.format(new Date(`${fromDate}T00:00:00Z`));
  const to = DAY_MONTH.format(new Date(`${toDate}T00:00:00Z`));
  return from === to ? from : `${from} to ${to}`;
}

/** "31 Oct 2026, 3:42 pm" in India time. */
export function formatDateTime(value: Date | string): string {
  return DATE_TIME.format(new Date(value)).replace(/\b(am|pm)\b/i, (m) => m.toLowerCase());
}

export interface AddressLike {
  name?: unknown;
  phone?: unknown;
  line1?: unknown;
  line2?: unknown;
  landmark?: unknown;
  city?: unknown;
  state?: unknown;
  pincode?: unknown;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Address snapshot -> display lines (empty parts dropped). */
export function addressLines(address: AddressLike): string[] {
  const cityLine = [text(address.city), text(address.state)].filter(Boolean).join(", ");
  return [
    text(address.name),
    text(address.line1),
    text(address.line2),
    text(address.landmark),
    [cityLine, text(address.pincode)].filter(Boolean).join(" - "),
  ].filter((line) => line.length > 0);
}
