import { eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";

import type * as schema from "@/server/db/schema";
import { settings } from "@/server/db/schema";
import { SETTINGS, type SettingKey, type SettingValue } from "@/server/services/settings-registry";

/**
 * A Drizzle database handle: the app's `getDb()` client or a transaction callback argument.
 * Every query function in the files under `services/queries/` and `services/{catalog,search,content}.ts` takes
 * one, so they can be run against any database (integration tests use the throwaway test DB) and
 * inside a caller's transaction. The cached wrappers in `src/server/cache/` pass `getDb()`.
 */
export type DbClient = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

export interface SettingReading<K extends SettingKey> {
  value: SettingValue<K>;
  /** True when the stored row is flagged as a placeholder (or was never written). */
  isPlaceholder: boolean;
}

/**
 * Reads several settings through the given handle (the settings service itself always uses the
 * global client). A missing row, or a stored value that no longer satisfies its schema, falls back
 * to the registry placeholder and is flagged `isPlaceholder`.
 */
export async function readSettings<K extends SettingKey>(
  db: DbClient,
  keys: readonly K[],
): Promise<{ [P in K]: SettingReading<P> }> {
  const rows = keys.length
    ? await db
        .select()
        .from(settings)
        .where(inArray(settings.key, keys as unknown as string[]))
    : [];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: Record<string, SettingReading<SettingKey>> = {};
  for (const key of keys) {
    const def = SETTINGS[key];
    const row = byKey.get(key);
    const parsed = def.schema.safeParse(row ? row.value : def.placeholder);
    out[key] = parsed.success
      ? {
          value: parsed.data as SettingValue<SettingKey>,
          isPlaceholder: row ? row.isPlaceholder : true,
        }
      : { value: def.schema.parse(def.placeholder) as SettingValue<SettingKey>, isPlaceholder: true };
  }
  return out as { [P in K]: SettingReading<P> };
}

export async function readSetting<K extends SettingKey>(
  db: DbClient,
  key: K,
): Promise<SettingReading<K>> {
  const all = await readSettings(db, [key]);
  return all[key];
}

/** Single-row existence helper used by tests/consumers. */
export async function settingRowExists(db: DbClient, key: SettingKey): Promise<boolean> {
  const rows = await db.select({ key: settings.key }).from(settings).where(eq(settings.key, key));
  return rows.length > 0;
}

export const SEARCH_QUERY_MAX_LENGTH = 100;

/**
 * Normalises user-typed search input: NFKC, control characters become spaces, whitespace is
 * collapsed, trimmed and capped at 100 characters. (SQL injection is prevented separately by
 * always passing the text as a bound parameter; this keeps the input sane.)
 */
export function sanitizeSearchQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SEARCH_QUERY_MAX_LENGTH)
      .trim()
  );
}
