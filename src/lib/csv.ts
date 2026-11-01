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

/** One parsed CSV record. */
export interface CsvRecord {
  /** 1-based line of the file on which the record starts (what a person sees in a spreadsheet row). */
  line: number;
  cells: string[];
}

/**
 * Parses CSV text (RFC 4180 style: quoted cells may hold commas, doubled quotes and line breaks;
 * CRLF, LF and a leading BOM are accepted). Fully blank lines are skipped. A tab or semicolon is
 * accepted as the separator when the first line has no comma (Excel in some locales saves that way).
 * Never throws: an unterminated quote simply runs to the end of the text.
 */
export function parseCsv(input: string): CsvRecord[] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const sep = firstLine.includes(",")
    ? ","
    : firstLine.includes("\t")
      ? "\t"
      : firstLine.includes(";")
        ? ";"
        : ",";

  const out: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let touched = false;

  const endRecord = () => {
    cells.push(cell);
    cell = "";
    if (touched && !(cells.length === 1 && cells[0]!.trim() === "")) {
      out.push({ line: startLine, cells });
    }
    cells = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (!touched) startLine = line;
    if (ch === '"' && cell === "") {
      quoted = true;
      touched = true;
    } else if (ch === sep) {
      touched = true;
      cells.push(cell);
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
    } else {
      touched = true;
      cell += ch;
    }
  }
  if (touched || cell !== "") endRecord();
  return out;
}

/** yes/no style cell to a boolean; `null` when empty ("leave as it is"); `undefined` when not understood. */
export function parseYesNo(value: string): boolean | null | undefined {
  const v = value.trim().toLowerCase();
  if (v === "") return null;
  if (["yes", "y", "true", "1", "on"].includes(v)) return true;
  if (["no", "n", "false", "0", "off"].includes(v)) return false;
  return undefined;
}
