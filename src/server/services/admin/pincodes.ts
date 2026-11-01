import "server-only";

import { and, asc, count, eq, ilike, inArray, like, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { parseCsv, parseYesNo, toCsv } from "@/lib/csv";
import { assertCan } from "@/server/auth/permissions";
import { pincodes, states } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { PINCODE_RE } from "@/server/services/commerce/pincode";
import type { DbClient } from "@/server/services/queries/shared";
import { SHIPPING_ZONES } from "@/server/services/settings-registry";

import { AdminInputError, type AdminActor } from "./products";

/**
 * Admin control of the pincode directory's two flags: `serviceable` (checkout refuses a pincode
 * that is off) and `cod_allowed` (COD is not offered where it is off). The directory itself (which
 * pincodes exist, their district, state and zone) is only ever changed by `scripts/import-pincodes.ts`;
 * nothing here adds or removes a pincode.
 *
 * Checkout, the PDP delivery check and order tracking read the flags straight from the table on every
 * request (`lookupPincodeInfo`, no `'use cache'`, no `unstable_cache`), so a change here is live for
 * the next shopper and there is nothing to revalidate.
 *
 * Audit: a single toggle writes one row for that pincode; a bulk action or a CSV import writes ONE row
 * with the counts and the filter / file summary (never one row per pincode, an import can touch 19,000).
 */

export const PINCODE_PAGE_SIZE = 50;
/** One CSV export / import is capped (the whole India directory is about 19,300 pincodes). */
export const PINCODE_CSV_MAX_ROWS = 25_000;
/** Server Actions accept bodies up to 1 MB by default; leave room for the rest of the request. */
export const PINCODE_CSV_MAX_CHARS = 900_000;
/** Rows per `IN (...)` statement, well under Postgres' 65,535 bind-parameter limit. */
const CHUNK = 5_000;
/** Problems and changes shown in a preview (the counts are always complete). */
const PREVIEW_ISSUES = 100;
const PREVIEW_CHANGES = 100;

// ---------------------------------------------------------------------------------------------
// Filters and reads
// ---------------------------------------------------------------------------------------------

export interface PincodeFilters {
  /** Digits: pincode prefix. Anything else: part of the district name. */
  q?: string;
  /** Two-digit GST state code. */
  stateCode?: string;
  zone?: string;
  serviceable?: boolean;
  /** Filters on `cod_allowed`. */
  cod?: boolean;
}

export const pincodeFiltersSchema = z.object({
  q: z.string().trim().max(60).optional(),
  stateCode: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
  zone: z.enum(SHIPPING_ZONES).optional(),
  serviceable: z.boolean().optional(),
  cod: z.boolean().optional(),
});

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

function where(filters: PincodeFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  const q = filters.q?.trim();
  if (q) {
    conds.push(
      /^\d+$/.test(q)
        ? like(pincodes.pincode, `${q}%`)
        : ilike(pincodes.district, `%${escapeLike(q)}%`),
    );
  }
  if (filters.stateCode) conds.push(eq(pincodes.stateCode, filters.stateCode));
  if (filters.zone) conds.push(eq(pincodes.zone, filters.zone));
  if (filters.serviceable !== undefined) conds.push(eq(pincodes.serviceable, filters.serviceable));
  if (filters.cod !== undefined) conds.push(eq(pincodes.codAllowed, filters.cod));
  return conds.length > 0 ? and(...conds) : undefined;
}

export interface PincodeRow {
  pincode: string;
  district: string;
  stateCode: string;
  stateName: string;
  zone: string | null;
  serviceable: boolean;
  codAllowed: boolean;
}

export interface PincodePage {
  items: PincodeRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

const rowColumns = {
  pincode: pincodes.pincode,
  district: pincodes.district,
  stateCode: pincodes.stateCode,
  stateName: states.name,
  zone: pincodes.zone,
  serviceable: pincodes.serviceable,
  codAllowed: pincodes.codAllowed,
};

/** One page of the directory (ordered by pincode) under the filters, plus the total match count. */
export async function listPincodes(
  db: DbClient,
  filters: PincodeFilters = {},
  page = 1,
): Promise<PincodePage> {
  const cond = where(filters);
  const [totalRow] = await db.select({ n: count() }).from(pincodes).where(cond);
  const total = totalRow?.n ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PINCODE_PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  const items = await db
    .select(rowColumns)
    .from(pincodes)
    .innerJoin(states, eq(states.code, pincodes.stateCode))
    .where(cond)
    .orderBy(asc(pincodes.pincode))
    .limit(PINCODE_PAGE_SIZE)
    .offset((current - 1) * PINCODE_PAGE_SIZE);
  return { items, total, page: current, pageCount, pageSize: PINCODE_PAGE_SIZE };
}

export interface PincodeFacets {
  states: { code: string; name: string }[];
  zones: readonly string[];
}

/** Choices for the state and zone filters. */
export async function getPincodeFacets(db: DbClient): Promise<PincodeFacets> {
  const rows = await db
    .select({ code: states.code, name: states.name })
    .from(states)
    .where(sql`exists (select 1 from ${pincodes} where ${pincodes.stateCode} = ${states.code})`)
    .orderBy(asc(states.name));
  return { states: rows, zones: SHIPPING_ZONES };
}

export interface PincodeSummary {
  total: number;
  notServiceable: number;
  codOff: number;
}

/** Whole-directory counts for the header of the screen (not affected by the filters). */
export async function getPincodeSummary(db: DbClient): Promise<PincodeSummary> {
  const [row] = await db
    .select({
      total: count(),
      notServiceable: sql<number>`count(*) filter (where not ${pincodes.serviceable})::int`,
      codOff: sql<number>`count(*) filter (where not ${pincodes.codAllowed})::int`,
    })
    .from(pincodes);
  return { total: row?.total ?? 0, notServiceable: row?.notServiceable ?? 0, codOff: row?.codOff ?? 0 };
}

// ---------------------------------------------------------------------------------------------
// One pincode
// ---------------------------------------------------------------------------------------------

export const pincodeFlagsInputSchema = z
  .object({
    pincode: z.string().regex(PINCODE_RE, "Enter a valid 6-digit pincode"),
    serviceable: z.boolean().optional(),
    codAllowed: z.boolean().optional(),
  })
  .refine((v) => v.serviceable !== undefined || v.codAllowed !== undefined, "Nothing to change");

export interface PincodeFlagsResult {
  pincode: string;
  changed: boolean;
  serviceable: boolean;
  codAllowed: boolean;
}

/** Turns serviceable and/or COD on or off for one pincode (audit row `pincode.update`). */
export async function setPincodeFlags(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<PincodeFlagsResult> {
  assertCan(actor.role, "setting:update");
  const input = pincodeFlagsInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ serviceable: pincodes.serviceable, codAllowed: pincodes.codAllowed })
      .from(pincodes)
      .where(eq(pincodes.pincode, input.pincode))
      .for("update");
    if (!current) throw new AdminInputError(`Pincode ${input.pincode} is not in the directory`);
    const next = {
      serviceable: input.serviceable ?? current.serviceable,
      codAllowed: input.codAllowed ?? current.codAllowed,
    };
    const diff: Record<string, { from: boolean; to: boolean }> = {};
    if (next.serviceable !== current.serviceable) {
      diff.serviceable = { from: current.serviceable, to: next.serviceable };
    }
    if (next.codAllowed !== current.codAllowed) {
      diff.codAllowed = { from: current.codAllowed, to: next.codAllowed };
    }
    if (Object.keys(diff).length === 0) return { pincode: input.pincode, changed: false, ...next };
    await tx.update(pincodes).set(next).where(eq(pincodes.pincode, input.pincode));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "pincode.update",
      entity: "pincode",
      entityId: input.pincode,
      diff,
      ip: actor.ip,
    });
    return { pincode: input.pincode, changed: true, ...next };
  });
}

// ---------------------------------------------------------------------------------------------
// Bulk change on a filter
// ---------------------------------------------------------------------------------------------

export const bulkInputSchema = z.object({
  filter: pincodeFiltersSchema,
  set: z
    .object({ serviceable: z.boolean().optional(), codAllowed: z.boolean().optional() })
    .refine((v) => v.serviceable !== undefined || v.codAllowed !== undefined, "Choose what to change"),
  /**
   * The number of pincodes the person confirmed ("this will change N pincodes"). When it no longer
   * matches, nothing is written, so the confirmation dialog never approves a different set.
   */
  expectedChanges: z.number().int().nonnegative().optional(),
});

export interface BulkPreview {
  /** Pincodes matching the filter. */
  matched: number;
  /** Of those, how many are not already in the requested state. */
  willChange: number;
}

type FlagSet = { serviceable?: boolean; codAllowed?: boolean };

function differs(set: FlagSet): SQL {
  const parts: SQL[] = [];
  if (set.serviceable !== undefined) parts.push(sql`${pincodes.serviceable} <> ${set.serviceable}`);
  if (set.codAllowed !== undefined) parts.push(sql`${pincodes.codAllowed} <> ${set.codAllowed}`);
  return sql.join(parts, sql` or `);
}

async function bulkCounts(db: DbClient, filter: PincodeFilters, set: FlagSet): Promise<BulkPreview> {
  const cond = where(filter);
  const [row] = await db
    .select({
      matched: count(),
      willChange: sql<number>`count(*) filter (where ${differs(set)})::int`,
    })
    .from(pincodes)
    .where(cond);
  return { matched: row?.matched ?? 0, willChange: row?.willChange ?? 0 };
}

/** How many pincodes a bulk action would match and change (shown in the confirmation dialog). */
export async function previewBulkPincodes(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<BulkPreview> {
  assertCan(actor.role, "setting:update");
  const input = bulkInputSchema.parse(raw);
  return bulkCounts(db, input.filter, input.set);
}

export interface BulkResult extends BulkPreview {
  changed: number;
}

/** Sets a flag on every pincode matching the filter, not just the page on screen (audit `pincode.bulk_update`). */
export async function bulkUpdatePincodes(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<BulkResult> {
  assertCan(actor.role, "setting:update");
  const input = bulkInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const before = await bulkCounts(tx, input.filter, input.set);
    if (input.expectedChanges !== undefined && input.expectedChanges !== before.willChange) {
      throw new AdminInputError(
        `The pincodes changed while you were confirming: ${before.willChange.toLocaleString("en-IN")} would change now, not ${input.expectedChanges.toLocaleString("en-IN")}. Nothing was saved; review and try again.`,
      );
    }
    if (before.willChange === 0) return { ...before, changed: 0 };
    const cond = and(where(input.filter), differs(input.set));
    const res = await tx.update(pincodes).set(input.set).where(cond);
    const changed = res.count;
    let stateName: string | null = null;
    if (input.filter.stateCode) {
      const [s] = await tx
        .select({ name: states.name })
        .from(states)
        .where(eq(states.code, input.filter.stateCode));
      stateName = s?.name ?? null;
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "pincode.bulk_update",
      entity: "pincode",
      diff: {
        filter: { ...input.filter, ...(stateName ? { stateName } : {}) },
        set: input.set,
        matched: before.matched,
        changed,
      },
      ip: actor.ip,
    });
    return { ...before, changed };
  });
}

// ---------------------------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------------------------

/** Rows for a CSV download of the filter, capped at {@link PINCODE_CSV_MAX_ROWS}. */
export async function exportPincodes(
  db: DbClient,
  filters: PincodeFilters,
): Promise<{ rows: PincodeRow[]; truncated: boolean }> {
  const rows = await db
    .select(rowColumns)
    .from(pincodes)
    .innerJoin(states, eq(states.code, pincodes.stateCode))
    .where(where(filters))
    .orderBy(asc(pincodes.pincode))
    .limit(PINCODE_CSV_MAX_ROWS + 1);
  return { rows: rows.slice(0, PINCODE_CSV_MAX_ROWS), truncated: rows.length > PINCODE_CSV_MAX_ROWS };
}

const yn = (v: boolean) => (v ? "yes" : "no");

/**
 * CSV with the three import columns first (`pincode,serviceable,cod_allowed`) and the directory
 * context after them. The import reads columns by header name and ignores the context ones, so an
 * export can be edited in a spreadsheet and uploaded again.
 */
export function pincodesCsv(rows: readonly PincodeRow[]): string {
  return toCsv(
    ["pincode", "serviceable", "cod_allowed", "district", "state", "zone"],
    rows.map((r) => [r.pincode, yn(r.serviceable), yn(r.codAllowed), r.district, r.stateName, r.zone ?? ""]),
  );
}

// ---------------------------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------------------------

export interface PincodeCsvLine {
  line: number;
  pincode: string;
  /** null = column empty or absent: leave the flag as it is. */
  serviceable: boolean | null;
  codAllowed: boolean | null;
}

export interface CsvIssue {
  /** 1-based line in the uploaded file; 0 for a problem with the file as a whole. */
  line: number;
  message: string;
}

const HEADER_PINCODE = ["pincode", "pin", "pin code", "pin_code", "pincodes"];
const HEADER_SERVICEABLE = ["serviceable", "deliverable", "delivery"];
const HEADER_COD = ["cod_allowed", "cod allowed", "cod"];

/**
 * Reads `pincode,serviceable,cod_allowed` (yes/no, true/false, y/n, 1/0; an empty cell leaves that
 * flag alone). A header row is recognised by its column names, in any order and with extra columns
 * ignored (so the export round-trips); without a header the first three columns are used in that
 * order. Pure: knows nothing about the database, so unknown pincodes are caught later by the preview.
 */
export function parsePincodeCsv(text: string): {
  rows: PincodeCsvLine[];
  issues: CsvIssue[];
  lines: number;
} {
  const records = parseCsv(text);
  const issues: CsvIssue[] = [];
  const rows: PincodeCsvLine[] = [];
  if (records.length === 0) {
    return { rows, issues: [{ line: 0, message: "The file is empty." }], lines: 0 };
  }

  let pinCol = 0;
  let servCol: number | null = 1;
  let codCol: number | null = 2;
  let data = records;
  const first = records[0]!;
  if (!/^\s*\d/.test(first.cells[0] ?? "")) {
    const names = first.cells.map((c) => c.trim().toLowerCase());
    const find = (aliases: string[]) => {
      const i = names.findIndex((n) => aliases.includes(n));
      return i === -1 ? null : i;
    };
    const p = find(HEADER_PINCODE);
    servCol = find(HEADER_SERVICEABLE);
    codCol = find(HEADER_COD);
    if (p === null) {
      issues.push({ line: first.line, message: 'The header row needs a "pincode" column.' });
    } else if (servCol === null && codCol === null) {
      issues.push({
        line: first.line,
        message: 'The header row needs a "serviceable" and/or a "cod_allowed" column.',
      });
    }
    if (issues.length > 0) return { rows, issues, lines: records.length - 1 };
    pinCol = p!;
    data = records.slice(1);
  }

  if (data.length > PINCODE_CSV_MAX_ROWS) {
    issues.push({
      line: 0,
      message: `Too many lines: ${data.length.toLocaleString("en-IN")} (at most ${PINCODE_CSV_MAX_ROWS.toLocaleString("en-IN")} per file).`,
    });
    return { rows, issues, lines: data.length };
  }

  const seen = new Map<string, number>();
  for (const rec of data) {
    const pincode = (rec.cells[pinCol] ?? "").trim();
    if (!PINCODE_RE.test(pincode)) {
      issues.push({
        line: rec.line,
        message: pincode
          ? `"${pincode.slice(0, 20)}" is not a valid 6-digit pincode.`
          : "The pincode is empty.",
      });
      continue;
    }
    const earlier = seen.get(pincode);
    if (earlier !== undefined) {
      issues.push({ line: rec.line, message: `Pincode ${pincode} is repeated (first on line ${earlier}).` });
      continue;
    }
    seen.set(pincode, rec.line);

    let ok = true;
    const flag = (col: number | null, label: string): boolean | null => {
      if (col === null) return null;
      const raw = rec.cells[col] ?? "";
      const v = parseYesNo(raw);
      if (v === undefined) {
        issues.push({
          line: rec.line,
          message: `"${raw.trim().slice(0, 20)}" is not yes or no (${label}).`,
        });
        ok = false;
        return null;
      }
      return v;
    };
    const serviceable = flag(servCol, "serviceable");
    const codAllowed = flag(codCol, "cod_allowed");
    if (!ok) continue;
    if (serviceable === null && codAllowed === null) {
      issues.push({ line: rec.line, message: `Pincode ${pincode}: both columns are empty, nothing to change.` });
      continue;
    }
    rows.push({ line: rec.line, pincode, serviceable, codAllowed });
  }
  return { rows, issues, lines: data.length };
}

export interface PincodeChange {
  line: number;
  pincode: string;
  district: string;
  stateCode: string;
  serviceable: { from: boolean; to: boolean };
  codAllowed: { from: boolean; to: boolean };
}

export interface PincodeCsvCounts {
  /** Lines with data (header excluded). */
  lines: number;
  /** Lines that change at least one flag. */
  changed: number;
  /** Valid lines that already match. */
  unchanged: number;
  serviceableOn: number;
  serviceableOff: number;
  codOn: number;
  codOff: number;
}

export interface PincodeCsvPreview {
  counts: PincodeCsvCounts;
  /** Problems, first {@link PREVIEW_ISSUES}. */
  issues: CsvIssue[];
  issueCount: number;
  /** First {@link PREVIEW_CHANGES} changes in file order. */
  changes: PincodeChange[];
  /** The apply step is allowed only when there are no problems and something changes. */
  canApply: boolean;
}

const csvTextSchema = z
  .string()
  .max(PINCODE_CSV_MAX_CHARS, "The file is too large. Split it into smaller files.");

/**
 * Checks the file against the directory: every line is validated, unknown pincodes are reported and
 * the changes are worked out against the CURRENT flags. Nothing is written.
 */
async function planCsv(
  db: DbClient,
  text: string,
): Promise<{ issues: CsvIssue[]; changes: PincodeChange[]; counts: PincodeCsvCounts }> {
  const parsed = parsePincodeCsv(text);
  const issues = [...parsed.issues];
  const current = new Map<
    string,
    { district: string; stateCode: string; serviceable: boolean; codAllowed: boolean }
  >();
  const wanted = parsed.rows.map((r) => r.pincode);
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const found = await db
      .select({
        pincode: pincodes.pincode,
        district: pincodes.district,
        stateCode: pincodes.stateCode,
        serviceable: pincodes.serviceable,
        codAllowed: pincodes.codAllowed,
      })
      .from(pincodes)
      .where(inArray(pincodes.pincode, wanted.slice(i, i + CHUNK)));
    for (const f of found) current.set(f.pincode, f);
  }

  const counts: PincodeCsvCounts = {
    lines: parsed.lines,
    changed: 0,
    unchanged: 0,
    serviceableOn: 0,
    serviceableOff: 0,
    codOn: 0,
    codOff: 0,
  };
  const changes: PincodeChange[] = [];
  for (const row of parsed.rows) {
    const cur = current.get(row.pincode);
    if (!cur) {
      issues.push({
        line: row.line,
        message: `Pincode ${row.pincode} is not in the directory. New pincodes come from the import script, not from this screen.`,
      });
      continue;
    }
    const to = {
      serviceable: row.serviceable ?? cur.serviceable,
      codAllowed: row.codAllowed ?? cur.codAllowed,
    };
    if (to.serviceable === cur.serviceable && to.codAllowed === cur.codAllowed) {
      counts.unchanged++;
      continue;
    }
    counts.changed++;
    if (to.serviceable !== cur.serviceable) counts[to.serviceable ? "serviceableOn" : "serviceableOff"]++;
    if (to.codAllowed !== cur.codAllowed) counts[to.codAllowed ? "codOn" : "codOff"]++;
    changes.push({
      line: row.line,
      pincode: row.pincode,
      district: cur.district,
      stateCode: cur.stateCode,
      serviceable: { from: cur.serviceable, to: to.serviceable },
      codAllowed: { from: cur.codAllowed, to: to.codAllowed },
    });
  }
  issues.sort((a, b) => a.line - b.line);
  return { issues, changes, counts };
}

/** Dry run of an upload: per-line problems, what would change, and counts. Writes nothing. */
export async function previewPincodeCsv(
  db: DbClient,
  rawText: unknown,
  actor: AdminActor,
): Promise<PincodeCsvPreview> {
  assertCan(actor.role, "setting:update");
  const text = csvTextSchema.parse(rawText);
  const plan = await planCsv(db, text);
  return {
    counts: plan.counts,
    issues: plan.issues.slice(0, PREVIEW_ISSUES),
    issueCount: plan.issues.length,
    changes: plan.changes.slice(0, PREVIEW_CHANGES),
    canApply: plan.issues.length === 0 && plan.counts.changed > 0,
  };
}

export const applyCsvInputSchema = z.object({
  text: csvTextSchema,
  /** Name of the uploaded file, for the audit row only. */
  fileName: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
  /** Changes the preview promised; a different number now means the flags moved in between. */
  expectedChanges: z.number().int().nonnegative().optional(),
});

export interface PincodeCsvResult {
  changed: number;
  unchanged: number;
}

/**
 * Applies an upload in one transaction. All or nothing: a file with ANY problem line is refused (fix
 * it and upload again), so what was previewed is exactly what is written. The plan is recomputed
 * inside the transaction against the live flags, and refused if the number of changes is not the one
 * the person saw in the preview.
 */
export async function applyPincodeCsv(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<PincodeCsvResult> {
  assertCan(actor.role, "setting:update");
  const input = applyCsvInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const plan = await planCsv(tx, input.text);
    if (plan.issues.length > 0) {
      throw new AdminInputError(
        `The file has ${plan.issues.length.toLocaleString("en-IN")} problem ${plan.issues.length === 1 ? "line" : "lines"}. Nothing was saved; fix them and upload the file again.`,
      );
    }
    if (input.expectedChanges !== undefined && input.expectedChanges !== plan.counts.changed) {
      throw new AdminInputError(
        `The pincodes changed after the preview: ${plan.counts.changed.toLocaleString("en-IN")} would change now, not ${input.expectedChanges.toLocaleString("en-IN")}. Nothing was saved; preview the file again.`,
      );
    }
    if (plan.counts.changed === 0) return { changed: 0, unchanged: plan.counts.unchanged };

    // Group by the final flag pair: at most four UPDATE shapes, chunked to stay under the bind limit.
    const groups = new Map<string, { serviceable: boolean; codAllowed: boolean; pincodes: string[] }>();
    for (const c of plan.changes) {
      const key = `${c.serviceable.to}:${c.codAllowed.to}`;
      const g = groups.get(key) ?? {
        serviceable: c.serviceable.to,
        codAllowed: c.codAllowed.to,
        pincodes: [],
      };
      g.pincodes.push(c.pincode);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      for (let i = 0; i < g.pincodes.length; i += CHUNK) {
        await tx
          .update(pincodes)
          .set({ serviceable: g.serviceable, codAllowed: g.codAllowed })
          .where(inArray(pincodes.pincode, g.pincodes.slice(i, i + CHUNK)));
      }
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "pincode.csv_import",
      entity: "pincode",
      diff: {
        file: input.fileName,
        ...plan.counts,
        /** A taste of what changed; the full list is the file itself. */
        sample: plan.changes.slice(0, 20).map((c) => c.pincode),
      },
      ip: actor.ip,
    });
    return { changed: plan.counts.changed, unchanged: plan.counts.unchanged };
  });
}
