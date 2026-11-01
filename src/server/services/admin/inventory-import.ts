import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { parseCsv } from "@/lib/csv";
import { assertCan } from "@/server/auth/permissions";
import { products, variants } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { adjustStock } from "@/server/services/inventory";
import type { DbClient } from "@/server/services/queries/shared";
import { loadVariantStock } from "@/server/services/queries/stock";

import { AdminInputError, type AdminActor } from "./products";

/**
 * Stock import from a CSV (`inventory:import`): set the on-hand count of many variants at once.
 *
 * Format. One row per variant with `SKU` and `On hand` (the new absolute count, not a change).
 * Those are two of the columns of the inventory export, and every other column is ignored, so
 * export -> edit "On hand" in a spreadsheet -> import round-trips. A header-less file is read as
 * `sku,stock_on_hand`. Header names are matched case-insensitively (`SKU`, `On hand`, `on_hand`,
 * `stock_on_hand`, `stock`, `quantity`).
 *
 * Ledger. Each changed variant gets one `inventory_movements` row (delta = new - current) through
 * {@link adjustStock}, so the ledger always adds up. `movement_reason` is a database enum with no
 * `import` value (adding one needs a migration), so the person chooses one of the existing reasons
 * for the whole file (a stock count = `adjust`, a data fix = `correction`, goods arriving =
 * `restock`) and the note on every row says it came from this file.
 *
 * Concurrency. A preview shows `old -> new` against the stock at that moment. Sales and checkouts keep
 * moving stock while the person reads it, so apply takes row locks on every variant in the file, re-reads
 * the on-hand counts and refuses the WHOLE import if any of them differs from what the preview showed
 * (reporting which SKUs moved). It never silently recomputes the deltas: what was approved is exactly what
 * is written, and a second preview takes seconds. All or nothing: any problem line also refuses the file.
 * Everything runs in one transaction with one audit row (`stock.import`).
 */

export const INVENTORY_IMPORT_MAX_ROWS = 5_000;
/** Server Actions accept bodies up to 1 MB by default; leave room for the rest of the request. */
export const INVENTORY_IMPORT_MAX_CHARS = 600_000;
/** Largest stock figure accepted per variant (matches the manual adjustment cap). */
export const INVENTORY_IMPORT_MAX_STOCK = 1_000_000;
const PREVIEW_ISSUES = 100;
const PREVIEW_ROWS = 200;
const CHUNK = 2_000;

export const IMPORT_REASONS = ["adjust", "correction", "restock"] as const;
export type ImportReason = (typeof IMPORT_REASONS)[number];

const HEADER_SKU = ["sku"];
const HEADER_STOCK = ["on hand", "on_hand", "onhand", "stock_on_hand", "stock on hand", "stock", "quantity", "qty"];

export interface InventoryCsvLine {
  line: number;
  sku: string;
  stock: number;
}

export interface InventoryCsvIssue {
  /** 1-based line in the file; 0 for a problem with the file as a whole. */
  line: number;
  message: string;
}

/**
 * Reads `SKU` + `On hand` (see the file doc). Pure: unknown SKUs are caught later against the
 * database. Reports bad numbers, negatives, duplicates and missing columns per line.
 */
export function parseInventoryCsv(text: string): {
  rows: InventoryCsvLine[];
  issues: InventoryCsvIssue[];
  lines: number;
} {
  const records = parseCsv(text);
  const rows: InventoryCsvLine[] = [];
  const issues: InventoryCsvIssue[] = [];
  if (records.length === 0) return { rows, issues: [{ line: 0, message: "The file is empty." }], lines: 0 };

  let skuCol = 0;
  let stockCol = 1;
  let data = records;
  const first = records[0]!;
  const names = first.cells.map((c) => c.trim().toLowerCase());
  const skuAt = names.findIndex((n) => HEADER_SKU.includes(n));
  const stockAt = names.findIndex((n) => HEADER_STOCK.includes(n));
  if (skuAt !== -1 || stockAt !== -1) {
    // A header row: both columns must be there.
    if (skuAt === -1) issues.push({ line: first.line, message: 'The header row needs a "SKU" column.' });
    if (stockAt === -1) {
      issues.push({ line: first.line, message: 'The header row needs an "On hand" column (the new stock count).' });
    }
    if (issues.length > 0) return { rows, issues, lines: records.length - 1 };
    skuCol = skuAt;
    stockCol = stockAt;
    data = records.slice(1);
  }

  if (data.length > INVENTORY_IMPORT_MAX_ROWS) {
    issues.push({
      line: 0,
      message: `Too many lines: ${data.length.toLocaleString("en-IN")} (at most ${INVENTORY_IMPORT_MAX_ROWS.toLocaleString("en-IN")} per file).`,
    });
    return { rows, issues, lines: data.length };
  }

  const seen = new Map<string, number>();
  for (const rec of data) {
    // The export writes a leading apostrophe before = + - @ so spreadsheets do not run it as a formula.
    const sku = (rec.cells[skuCol] ?? "").trim().replace(/^'(?=[=+\-@])/, "");
    if (!sku) {
      issues.push({ line: rec.line, message: "The SKU is empty." });
      continue;
    }
    const earlier = seen.get(sku);
    if (earlier !== undefined) {
      issues.push({ line: rec.line, message: `SKU ${sku} is repeated (first on line ${earlier}).` });
      continue;
    }
    seen.set(sku, rec.line);
    const raw = (rec.cells[stockCol] ?? "").trim();
    if (raw === "") {
      issues.push({ line: rec.line, message: `${sku}: the stock count is empty.` });
      continue;
    }
    if (/^-\d+(\.0+)?$/.test(raw)) {
      issues.push({ line: rec.line, message: `${sku}: stock cannot be negative (${raw}).` });
      continue;
    }
    if (!/^\d+(\.0+)?$/.test(raw)) {
      issues.push({ line: rec.line, message: `${sku}: "${raw.slice(0, 20)}" is not a whole number.` });
      continue;
    }
    const stock = Number.parseInt(raw, 10);
    if (stock > INVENTORY_IMPORT_MAX_STOCK) {
      issues.push({
        line: rec.line,
        message: `${sku}: ${stock.toLocaleString("en-IN")} is too large (at most ${INVENTORY_IMPORT_MAX_STOCK.toLocaleString("en-IN")}).`,
      });
      continue;
    }
    rows.push({ line: rec.line, sku, stock });
  }
  return { rows, issues, lines: data.length };
}

export interface InventoryImportChange {
  line: number;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantTitle: string;
  from: number;
  to: number;
  delta: number;
  /** Units held by open checkouts (informational). */
  reserved: number;
  /** Set when the new count is below what open checkouts hold. */
  warning: string | null;
}

export interface InventoryImportCounts {
  lines: number;
  changed: number;
  unchanged: number;
  increases: number;
  decreases: number;
  unitsAdded: number;
  unitsRemoved: number;
}

export interface InventoryImportPreview {
  counts: InventoryImportCounts;
  issues: InventoryImportIssueList;
  /** First {@link PREVIEW_ROWS} changes in file order. */
  changes: InventoryImportChange[];
  /** What the apply step must send back so it can detect stock that moved in between. */
  baseline: { sku: string; onHand: number }[];
  canApply: boolean;
}

export interface InventoryImportIssueList {
  items: InventoryCsvIssue[];
  total: number;
}

const importInputSchema = z.object({
  text: z.string().max(INVENTORY_IMPORT_MAX_CHARS, "The file is too large. Split it into smaller files."),
  reason: z.enum(IMPORT_REASONS),
  note: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  fileName: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => v || null),
});

const previewInputSchema = importInputSchema.omit({ fileName: true });

const applyInputSchema = importInputSchema.extend({
  /** On-hand counts the preview showed, for the changed variants. */
  baseline: z
    .array(z.object({ sku: z.string().max(200), onHand: z.number().int().nonnegative() }))
    .max(INVENTORY_IMPORT_MAX_ROWS),
});

/**
 * Validates the file against the catalogue and works out the changes against the stock found now.
 * `lock` takes row locks on the variants (inside the apply transaction).
 */
async function planImport(
  db: DbClient,
  text: string,
  reason: ImportReason,
  opts: { lock?: boolean } = {},
): Promise<{ issues: InventoryCsvIssue[]; changes: InventoryImportChange[]; counts: InventoryImportCounts }> {
  const parsed = parseInventoryCsv(text);
  const issues = [...parsed.issues];

  const found = new Map<
    string,
    {
      id: string;
      productId: string;
      productName: string;
      productStatus: string;
      variantTitle: string;
      onHand: number;
    }
  >();
  const skus = parsed.rows.map((r) => r.sku);
  for (let i = 0; i < skus.length; i += CHUNK) {
    const q = db
      .select({
        id: variants.id,
        sku: variants.sku,
        productId: variants.productId,
        productName: products.name,
        productStatus: products.status,
        variantTitle: variants.title,
        onHand: variants.stockOnHand,
      })
      .from(variants)
      .innerJoin(products, eq(variants.productId, products.id))
      .where(inArray(variants.sku, skus.slice(i, i + CHUNK)))
      .orderBy(asc(variants.id));
    const rows = opts.lock ? await q.for("update", { of: variants }) : await q;
    for (const r of rows) found.set(r.sku, r);
  }

  const reservedBy = new Map<string, number>();
  if (!opts.lock && found.size > 0) {
    const stock = await loadVariantStock(
      db,
      [...found.values()].map((f) => f.id),
      new Date(),
    );
    for (const s of stock) reservedBy.set(s.variantId, Math.max(0, s.onHand - s.available));
  }

  const counts: InventoryImportCounts = {
    lines: parsed.lines,
    changed: 0,
    unchanged: 0,
    increases: 0,
    decreases: 0,
    unitsAdded: 0,
    unitsRemoved: 0,
  };
  const changes: InventoryImportChange[] = [];
  for (const row of parsed.rows) {
    const v = found.get(row.sku);
    if (!v) {
      issues.push({ line: row.line, message: `${row.sku}: no variant with this SKU.` });
      continue;
    }
    if (v.productStatus === "archived") {
      issues.push({ line: row.line, message: `${row.sku}: belongs to an archived product (not listed in Inventory).` });
      continue;
    }
    const delta = row.stock - v.onHand;
    if (delta === 0) {
      counts.unchanged++;
      continue;
    }
    if (reason === "restock" && delta < 0) {
      issues.push({
        line: row.line,
        message: `${row.sku}: ${v.onHand} to ${row.stock} lowers the stock; "Restock" can only add. Choose "Stock count" for this file.`,
      });
      continue;
    }
    counts.changed++;
    if (delta > 0) {
      counts.increases++;
      counts.unitsAdded += delta;
    } else {
      counts.decreases++;
      counts.unitsRemoved += -delta;
    }
    const reserved = reservedBy.get(v.id) ?? 0;
    changes.push({
      line: row.line,
      variantId: v.id,
      productId: v.productId,
      sku: row.sku,
      productName: v.productName,
      variantTitle: v.variantTitle,
      from: v.onHand,
      to: row.stock,
      delta,
      reserved,
      warning:
        row.stock < reserved
          ? `${reserved} held by open checkouts; those orders may fail to complete`
          : null,
    });
  }
  issues.sort((a, b) => a.line - b.line);
  return { issues, changes, counts };
}

/** Dry run of an upload: per-line problems, old to new for every change, counts. Writes nothing. */
export async function previewInventoryImport(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<InventoryImportPreview> {
  assertCan(actor.role, "inventory:import");
  const input = previewInputSchema.parse(raw);
  const plan = await planImport(db, input.text, input.reason);
  return {
    counts: plan.counts,
    issues: { items: plan.issues.slice(0, PREVIEW_ISSUES), total: plan.issues.length },
    changes: plan.changes.slice(0, PREVIEW_ROWS),
    baseline: plan.changes.map((c) => ({ sku: c.sku, onHand: c.from })),
    canApply: plan.issues.length === 0 && plan.counts.changed > 0,
  };
}

export interface InventoryImportResult {
  changed: number;
  unchanged: number;
  /** Products whose stock caches must be expired. */
  productIds: string[];
}

/** Applies a previewed file (see the file doc: all or nothing, one transaction, one audit row). */
export async function applyInventoryImport(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<InventoryImportResult> {
  assertCan(actor.role, "inventory:import");
  const input = applyInputSchema.parse(raw);
  const note = [`CSV import${input.fileName ? ` ${input.fileName}` : ""}`, input.note].filter(Boolean).join(": ").slice(0, 300);
  return db.transaction(async (tx) => {
    const plan = await planImport(tx, input.text, input.reason, { lock: true });
    if (plan.issues.length > 0) {
      throw new AdminInputError(
        `The file has ${plan.issues.length.toLocaleString("en-IN")} problem ${plan.issues.length === 1 ? "line" : "lines"}. Nothing was saved; fix them and upload the file again.`,
      );
    }
    // Stock that moved since the preview (a sale, a restock, another import): refuse and say where.
    const shown = new Map(input.baseline.map((b) => [b.sku, b.onHand]));
    const moved = plan.changes.filter((c) => shown.get(c.sku) !== c.from);
    const vanished = [...shown.keys()].filter((sku) => !plan.changes.some((c) => c.sku === sku));
    if (moved.length > 0 || vanished.length > 0) {
      const examples = moved
        .slice(0, 3)
        .map((c) => `${c.sku} (was ${shown.get(c.sku) ?? "unchanged"}, now ${c.from})`)
        .join(", ");
      throw new AdminInputError(
        `Stock changed after the preview${examples ? `: ${examples}${moved.length > 3 ? ` and ${moved.length - 3} more` : ""}` : ""}. Nothing was saved; upload the file again to see the new differences.`,
      );
    }
    if (plan.changes.length === 0) return { changed: 0, unchanged: plan.counts.unchanged, productIds: [] };

    for (const c of plan.changes) {
      await adjustStock(
        { variantId: c.variantId, delta: c.delta, reason: input.reason, actorId: actor.id, note },
        tx,
      );
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "stock.import",
      entity: "variant",
      diff: {
        file: input.fileName,
        reason: input.reason,
        note: input.note,
        ...plan.counts,
        sample: plan.changes.slice(0, 20).map((c) => ({ sku: c.sku, from: c.from, to: c.to })),
      },
      ip: actor.ip,
    });
    return {
      changed: plan.counts.changed,
      unchanged: plan.counts.unchanged,
      productIds: [...new Set(plan.changes.map((c) => c.productId))],
    };
  });
}
