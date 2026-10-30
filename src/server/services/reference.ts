import "server-only";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, type Database } from "@/server/db";
import { pincodes, states } from "@/server/db/schema";

/**
 * Reference data: Indian states/UTs and the India Post pincode directory.
 *
 * File contract (data/reference/):
 *  - states.json   array of { name, code (2-digit GST code), iso, type: "state" | "ut" }
 *  - zones.json    { _PLACEHOLDER?, zones: string[], stateZones: { [state name]: zone } }
 *  - pincodes.csv  header `pincode,district,state,office_count`; `state` = a states.json `name`
 */

export const DEFAULT_REFERENCE_DIR = path.join(process.cwd(), "data", "reference");

const stateRowSchema = z.object({
  name: z.string().min(1),
  code: z.string().regex(/^\d{2}$/, "GST state code must be 2 digits"),
  iso: z.string().min(1),
  type: z.enum(["state", "ut"]),
});
const statesFileSchema = z.array(stateRowSchema).min(1);
const zonesFileSchema = z.object({
  zones: z.array(z.string().min(1)).min(1),
  stateZones: z.record(z.string(), z.string()),
});

export class ReferenceFilesMissingError extends Error {
  constructor(
    readonly dir: string,
    readonly missing: string[],
  ) {
    super(
      `Reference data not found in ${dir}. Missing: ${missing.join(", ")}.\n` +
        `Expected states.json, zones.json and pincodes.csv (see src/server/services/reference.ts for the contract).`,
    );
    this.name = "ReferenceFilesMissingError";
  }
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

export interface ReferenceImportOptions {
  dir?: string;
  db?: Database;
  /** Rows per INSERT statement (default 2000). */
  batchSize?: number;
  log?: (message: string) => void;
}

export interface ReferenceImportResult {
  states: number;
  pincodes: number;
  /** Pincode rows skipped (bad format, duplicate pincode, unknown state). */
  skipped: number;
  unknownStates: string[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Idempotent upsert of states and pincodes. Re-running refreshes name/district/state/zone but
 * NEVER touches `serviceable` / `cod_allowed`, which admins edit.
 */
export async function importReference(
  opts: ReferenceImportOptions = {},
): Promise<ReferenceImportResult> {
  const dir = path.resolve(opts.dir ?? DEFAULT_REFERENCE_DIR);
  const db = opts.db ?? getDb();
  const batchSize = opts.batchSize ?? 2000;
  const log = opts.log ?? (() => {});

  const files = {
    states: path.join(dir, "states.json"),
    zones: path.join(dir, "zones.json"),
    pincodes: path.join(dir, "pincodes.csv"),
  };
  const missing = Object.values(files)
    .filter((f) => !existsSync(f))
    .map((f) => path.basename(f));
  if (missing.length > 0) throw new ReferenceFilesMissingError(dir, missing);

  const stateRows = statesFileSchema.parse(JSON.parse(readFileSync(files.states, "utf8")));
  const zonesFile = zonesFileSchema.parse(JSON.parse(readFileSync(files.zones, "utf8")));
  for (const [stateName, zone] of Object.entries(zonesFile.stateZones)) {
    if (!zonesFile.zones.includes(zone)) {
      throw new Error(`zones.json: state "${stateName}" uses unknown zone "${zone}"`);
    }
  }

  const stateByName = new Map(stateRows.map((s) => [s.name, s]));
  const stateValues = stateRows.map((s) => ({
    code: s.code,
    name: s.name,
    iso: s.iso,
    type: s.type,
    zone: zonesFile.stateZones[s.name] ?? null,
  }));
  await db
    .insert(states)
    .values(stateValues)
    .onConflictDoUpdate({
      target: states.code,
      set: {
        name: sql`excluded.name`,
        iso: sql`excluded.iso`,
        type: sql`excluded.type`,
        zone: sql`excluded.zone`,
      },
    });
  log(`states: upserted ${stateValues.length}`);

  const csv = parseCsv(readFileSync(files.pincodes, "utf8"));
  const [header, ...body] = csv;
  const col = (name: string) => header?.indexOf(name) ?? -1;
  const [iPin, iDistrict, iState] = [col("pincode"), col("district"), col("state")];
  if (iPin < 0 || iDistrict < 0 || iState < 0) {
    throw new Error("pincodes.csv must have columns: pincode,district,state,office_count");
  }

  const unknown = new Set<string>();
  const seen = new Set<string>();
  let skipped = 0;
  const pinValues: (typeof pincodes.$inferInsert)[] = [];
  for (const r of body) {
    const pin = (r[iPin] ?? "").trim();
    const stateName = (r[iState] ?? "").trim();
    const st = stateByName.get(stateName);
    if (!/^\d{6}$/.test(pin) || seen.has(pin)) {
      skipped++;
      continue;
    }
    if (!st) {
      unknown.add(stateName);
      skipped++;
      continue;
    }
    seen.add(pin);
    pinValues.push({
      pincode: pin,
      district: (r[iDistrict] ?? "").trim() || "Unknown",
      stateCode: st.code,
      zone: zonesFile.stateZones[st.name] ?? null,
    });
  }

  let done = 0;
  for (const batch of chunk(pinValues, batchSize)) {
    await db
      .insert(pincodes)
      .values(batch)
      .onConflictDoUpdate({
        target: pincodes.pincode,
        set: {
          district: sql`excluded.district`,
          stateCode: sql`excluded.state_code`,
          zone: sql`excluded.zone`,
        },
      });
    done += batch.length;
    log(`pincodes: ${done}/${pinValues.length}`);
  }

  return {
    states: stateValues.length,
    pincodes: pinValues.length,
    skipped,
    unknownStates: [...unknown],
  };
}

export interface PincodeInfo {
  pincode: string;
  district: string;
  stateCode: string;
  stateName: string;
  zone: string | null;
  serviceable: boolean;
  codAllowed: boolean;
}

/** Looks up a pincode (checkout autofill, serviceability and COD eligibility). */
export async function lookupPincode(pincode: string): Promise<PincodeInfo | null> {
  if (!/^\d{6}$/.test(pincode)) return null;
  const [row] = await getDb()
    .select({
      pincode: pincodes.pincode,
      district: pincodes.district,
      stateCode: pincodes.stateCode,
      stateName: states.name,
      zone: pincodes.zone,
      serviceable: pincodes.serviceable,
      codAllowed: pincodes.codAllowed,
    })
    .from(pincodes)
    .innerJoin(states, eq(states.code, pincodes.stateCode))
    .where(eq(pincodes.pincode, pincode))
    .limit(1);
  return row ?? null;
}
