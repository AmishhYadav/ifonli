import "server-only";

import { eq, sql } from "drizzle-orm";

import { assertCan } from "@/server/auth/permissions";
import { settings, states, user } from "@/server/db/schema";
import { VIBES } from "@/features/vibe/config";
import { writeAudit } from "@/server/services/audit";
import type { DbClient } from "@/server/services/queries/shared";
import {
  SETTINGS,
  SETTING_KEYS,
  isRequiredForLaunch,
  isSettingKey,
  type SettingGroup,
  type SettingKey,
} from "@/server/services/settings-registry";

import { AdminInputError, type AdminActor } from "./products";

/**
 * Owner-only settings editor backed by the registry (`settings-registry.ts`). Saving validates the value
 * with the key's Zod schema (plus a few cross-checks), clears `is_placeholder` and writes an audit row with
 * the before / after values, all in one transaction. The caller runs `revalidateSettings()`.
 */

export interface AdminSettingRow {
  key: SettingKey;
  group: SettingGroup;
  label: string;
  description: string;
  value: unknown;
  /** Registry placeholder, valid under the schema (shown as the form's "example"). */
  placeholder: unknown;
  isPlaceholder: boolean;
  /** Blocks launch while still a placeholder (`requiredUnless` applied). */
  blocksLaunch: boolean;
  requiredForLaunch: boolean;
  locked: boolean;
  updatedAt: Date | null;
  updatedByName: string | null;
}

export interface SettingIssue {
  /** Dotted path inside the value (`email`, `metro_region.minDays`); empty = the whole value. */
  path: string;
  message: string;
}

export class SettingAdminValidationError extends AdminInputError {
  constructor(
    readonly key: string,
    readonly issues: SettingIssue[],
  ) {
    super(
      issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ") ||
        "Invalid value",
    );
    this.name = "SettingAdminValidationError";
  }
}

const PLACEHOLDER_TEXT = /^\s*PLACEHOLDER\b/;
const PLACEHOLDER_EMAIL = /@example\.invalid$/i;

/** Paths of string leaves that still hold the registry's fake text (`PLACEHOLDER …`, `…@example.invalid`). */
export function placeholderTextPaths(value: unknown, path = ""): string[] {
  if (typeof value === "string") {
    return PLACEHOLDER_TEXT.test(value) || PLACEHOLDER_EMAIL.test(value.trim()) ? [path] : [];
  }
  if (Array.isArray(value))
    return value.flatMap((v, i) => placeholderTextPaths(v, path ? `${path}.${i}` : String(i)));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      placeholderTextPaths(v, path ? `${path}.${k}` : k),
    );
  }
  return [];
}

export async function listSettingsAdmin(db: DbClient): Promise<AdminSettingRow[]> {
  const rows = await db
    .select({
      key: settings.key,
      value: settings.value,
      isPlaceholder: settings.isPlaceholder,
      updatedAt: settings.updatedAt,
      updatedByName: user.name,
    })
    .from(settings)
    .leftJoin(user, eq(settings.updatedBy, user.id));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const read = (key: SettingKey) => {
    const def = SETTINGS[key];
    const row = byKey.get(key);
    const parsed = def.schema.safeParse(row ? row.value : def.placeholder);
    // A stored value the schema no longer accepts shows the placeholder and counts as unset.
    return {
      value: parsed.success ? parsed.data : def.schema.parse(def.placeholder),
      isPlaceholder: row ? row.isPlaceholder || !parsed.success : true,
    };
  };
  const valueOf = (key: string) => (isSettingKey(key) ? read(key).value : undefined);
  return SETTING_KEYS.map((key) => {
    const def = SETTINGS[key];
    const { value, isPlaceholder } = read(key);
    const row = byKey.get(key);
    return {
      key,
      group: def.group,
      label: def.label,
      description: def.description,
      value,
      placeholder: def.schema.parse(def.placeholder),
      isPlaceholder,
      requiredForLaunch: def.requiredForLaunch,
      blocksLaunch: isPlaceholder && isRequiredForLaunch(def, valueOf),
      locked: "locked" in def && def.locked === true,
      updatedAt: row?.updatedAt ?? null,
      updatedByName: row?.updatedByName ?? null,
    };
  });
}

/** Cross-field checks the Zod schemas cannot express (they need the database or the vibe list). */
async function extraIssues(db: DbClient, key: SettingKey, value: unknown): Promise<SettingIssue[]> {
  const issues: SettingIssue[] = [];
  const knownVibes = VIBES as readonly string[];
  switch (key) {
    case "default_vibe":
      if (value !== "random" && !knownVibes.includes(String(value))) {
        issues.push({ path: "", message: `Choose one of: ${[...VIBES, "random"].join(", ")}` });
      }
      break;
    case "vibe_cycle": {
      const list = value as string[];
      const bad = list.filter((v) => !knownVibes.includes(v));
      if (bad.length) issues.push({ path: "", message: `Unknown vibe: ${bad.join(", ")}` });
      if (new Set(list).size !== list.length)
        issues.push({ path: "", message: "A vibe is listed twice" });
      break;
    }
    case "admin_alert_emails": {
      const list = value as string[];
      if (new Set(list.map((e) => e.toLowerCase())).size !== list.length) {
        issues.push({ path: "", message: "An address is listed twice" });
      }
      break;
    }
    case "cod_excluded_pincodes": {
      const list = value as string[];
      if (new Set(list).size !== list.length)
        issues.push({ path: "", message: "A pincode is listed twice" });
      break;
    }
    case "state": {
      // GST place of supply must match a `states` row, when the reference data is loaded.
      const known = await db.select({ name: states.name }).from(states);
      if (
        known.length > 0 &&
        !known.some((s) => s.name.toLowerCase() === String(value).trim().toLowerCase())
      ) {
        issues.push({ path: "", message: "Not a known Indian state or union territory name" });
      }
      break;
    }
    default:
      break;
  }
  return issues;
}

/**
 * Validates and stores one setting (owner only: `setting:update`). Throws `SettingAdminValidationError`
 * with per-path issues for an invalid value, `AdminInputError` for a locked or unknown key.
 */
export async function updateSettingAdmin(
  db: DbClient,
  key: string,
  rawValue: unknown,
  actor: AdminActor,
): Promise<{ key: SettingKey; value: unknown; changed: boolean }> {
  assertCan(actor.role, "setting:update");
  if (!isSettingKey(key)) throw new AdminInputError("Unknown setting");
  const def = SETTINGS[key];
  if ("locked" in def && def.locked)
    throw new AdminInputError(`"${def.label}" is locked and cannot be changed`);

  const parsed = def.schema.safeParse(rawValue);
  if (!parsed.success) {
    throw new SettingAdminValidationError(
      key,
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const value: unknown = parsed.data;
  const issues: SettingIssue[] = [
    ...placeholderTextPaths(value).map((path) => ({
      path,
      message: "Replace the placeholder text with the real value",
    })),
    ...(await extraIssues(db, key, value)),
  ];
  if (issues.length) throw new SettingAdminValidationError(key, issues);

  // JSON `null` must be written as the jsonb literal; a bare JS null would become SQL NULL.
  const json = value === null ? sql`'null'::jsonb` : value;
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(settings).where(eq(settings.key, key)).for("update");
    await tx
      .insert(settings)
      .values({ key, value: json, isPlaceholder: false, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: json, isPlaceholder: false, updatedBy: actor.id },
      });
    const changed = !before || JSON.stringify(before.value) !== JSON.stringify(value);
    await writeAudit(tx, {
      actorId: actor.id,
      action: "setting.update",
      entity: "setting",
      entityId: key,
      diff: {
        before: before ? { value: before.value, isPlaceholder: before.isPlaceholder } : null,
        after: { value, isPlaceholder: false },
      },
      ip: actor.ip,
    });
    return { key, value, changed };
  });
}
