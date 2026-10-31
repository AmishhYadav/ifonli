import "server-only";

import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/server/db";
import { adminAuditLog, settings } from "@/server/db/schema";

import {
  SETTINGS,
  SETTING_KEYS,
  isRequiredForLaunch,
  settingsInGroup,
  type SettingGroup,
  type SettingInput,
  type SettingKey,
  type SettingValue,
} from "./settings-registry";

export * from "./settings-registry";

export class SettingValidationError extends Error {
  constructor(
    readonly key: string,
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(`Invalid value for setting "${key}": ${issues.map((i) => i.message).join("; ")}`);
    this.name = "SettingValidationError";
  }
}

export class SettingLockedError extends Error {
  constructor(readonly key: string) {
    super(`Setting "${key}" is locked and cannot be changed`);
    this.name = "SettingLockedError";
  }
}

export interface SettingEntry<K extends SettingKey = SettingKey> {
  key: K;
  group: SettingGroup;
  label: string;
  description: string;
  value: SettingValue<K>;
  isPlaceholder: boolean;
  requiredForLaunch: boolean;
  locked: boolean;
}

/** JSON `null` must be sent as the jsonb literal; a bare JS null would become SQL NULL. */
function jsonb(value: unknown) {
  return value === null ? sql`'null'::jsonb` : value;
}

function toEntry<K extends SettingKey>(
  key: K,
  stored: { value: unknown; isPlaceholder: boolean } | undefined,
): SettingEntry<K> {
  const def = SETTINGS[key];
  const raw = stored ? stored.value : def.placeholder;
  const parsed = def.schema.safeParse(raw);
  // A stored value that no longer satisfies the schema (schema tightened later) falls back to the
  // placeholder and is flagged so it shows up as a launch blocker rather than crashing a page.
  const ok = parsed.success;
  const value = (ok ? parsed.data : def.schema.parse(def.placeholder)) as SettingValue<K>;
  return {
    key,
    group: def.group,
    label: def.label,
    description: def.description,
    value,
    isPlaceholder: stored ? stored.isPlaceholder || !ok : true,
    requiredForLaunch: def.requiredForLaunch,
    locked: "locked" in def && def.locked === true,
  };
}

/** Typed read of one setting. A key that was never written yields its placeholder value. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  return (await getSettingEntry(key)).value;
}

export async function getSettingEntry<K extends SettingKey>(key: K): Promise<SettingEntry<K>> {
  const [row] = await getDb().select().from(settings).where(eq(settings.key, key)).limit(1);
  return toEntry(key, row);
}

/** All settings of a group (registry order), including placeholder flags. */
export async function getSettings(group: SettingGroup): Promise<SettingEntry[]> {
  const keys = settingsInGroup(group);
  const rows = await getDb().select().from(settings).where(inArray(settings.key, keys));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return keys.map((k) => toEntry(k, byKey.get(k)));
}

/** Every registry key (registry order) in one query, for pages that mix many settings (policies). */
export async function getAllSettingEntries(): Promise<SettingEntry[]> {
  const rows = await getDb().select().from(settings);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SETTING_KEYS.map((k) => toEntry(k, byKey.get(k)));
}

/**
 * Validates and stores a setting, clears its placeholder flag and writes an audit-log row
 * (before/after) in the same transaction. `actorId` is a Better Auth user id, or null for system.
 */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingInput<K>,
  actorId: string | null,
): Promise<SettingValue<K>> {
  const def = SETTINGS[key] as (typeof SETTINGS)[SettingKey] | undefined;
  if (!def) throw new Error(`Unknown setting "${String(key)}"`);
  if ("locked" in def && def.locked) throw new SettingLockedError(key);

  const parsed = def.schema.safeParse(value);
  if (!parsed.success) throw new SettingValidationError(key, parsed.error.issues);

  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(settings).where(eq(settings.key, key)).limit(1);
    await tx
      .insert(settings)
      .values({ key, value: jsonb(parsed.data), isPlaceholder: false, updatedBy: actorId })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: jsonb(parsed.data), isPlaceholder: false, updatedBy: actorId },
      });
    await tx.insert(adminAuditLog).values({
      actorId,
      action: "setting.update",
      entity: "setting",
      entityId: key,
      diff: {
        before: before ? { value: before.value, isPlaceholder: before.isPlaceholder } : null,
        after: { value: parsed.data, isPlaceholder: false },
      },
    });
  });
  return parsed.data as SettingValue<K>;
}

export interface LaunchBlocker {
  key: SettingKey;
  group: SettingGroup;
  label: string;
}

/** Required-for-launch settings that are still placeholders (or were never written). */
export async function getLaunchBlockers(): Promise<LaunchBlocker[]> {
  const rows = await getDb().select().from(settings);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const blockers: LaunchBlocker[] = [];
  const valueOf = (key: string) =>
    (SETTING_KEYS as readonly string[]).includes(key)
      ? toEntry(key as SettingKey, byKey.get(key)).value
      : undefined;
  for (const key of SETTING_KEYS) {
    const def = SETTINGS[key];
    if (!isRequiredForLaunch(def, valueOf)) continue;
    const entry = toEntry(key, byKey.get(key));
    if (entry.isPlaceholder) blockers.push({ key, group: def.group, label: def.label });
  }
  return blockers;
}

/**
 * Inserts every registry key that has no row yet (value = placeholder, `is_placeholder` = true,
 * except owner-confirmed keys). Never overwrites existing rows, so reseeding is safe.
 * Returns the number of rows inserted.
 */
export async function seedMissingSettings(): Promise<number> {
  const rows = SETTING_KEYS.map((key) => {
    const def = SETTINGS[key];
    return {
      key,
      value: jsonb(def.schema.parse(def.placeholder)),
      isPlaceholder: !("confirmed" in def && def.confirmed),
    };
  });
  const inserted = await getDb()
    .insert(settings)
    .values(rows)
    .onConflictDoNothing({ target: settings.key })
    .returning({ key: settings.key });
  return inserted.length;
}
