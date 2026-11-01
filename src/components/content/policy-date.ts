/**
 * "1 November 2026" for a policy's effective date. The date is stored as midnight India time (the admin picks
 * an IST calendar date), so it is formatted in `Asia/Kolkata`: in UTC it would read as the day before.
 */
const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" });

export function formatPolicyDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
