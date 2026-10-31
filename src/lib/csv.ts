export type CsvValue = string | number | null | undefined;

/**
 * One CSV cell. Text starting with = + - @ (or a tab / CR) is prefixed with an apostrophe so spreadsheets
 * do not run it as a formula; numbers are written as-is. Fields with commas, quotes or line breaks are quoted.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CRLF-separated CSV with a header row and a trailing newline. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return lines.join("\r\n") + "\r\n";
}

/** Paise as a plain rupee amount with two decimals ("1299.00"), for spreadsheets. */
export function rupees(paise: number): string {
  return (paise / 100).toFixed(2);
}
