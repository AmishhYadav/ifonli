import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { resolveVibeSettings, type VibeSettings } from "@/features/vibe/settings";
import { getSettings } from "@/server/services/settings";

import { SETTINGS_TAG } from "./tags";

/**
 * Cached storefront settings reads (`'use cache'` + tag `settings`; `revalidateSettings()` expires them).
 * Only the keys the storefront shell shows are exposed, as plain serialisable data.
 */

export type { VibeSettings };

export interface StoreValue {
  value: string;
  /** Still the registry placeholder (never written by the owner). Shown loudly in dev. */
  isPlaceholder: boolean;
}

export interface StoreInfo {
  brandName: string;
  legalName: StoreValue;
  registeredAddress: StoreValue;
  supportEmail: StoreValue;
  supportPhone: StoreValue;
  supportHours: StoreValue;
  responseTime: StoreValue;
  grievance: {
    name: StoreValue;
    designation: StoreValue;
    email: StoreValue;
    phone: StoreValue;
  };
}

export async function getVibeSettings(): Promise<VibeSettings> {
  "use cache";
  cacheLife("hours");
  cacheTag(SETTINGS_TAG);
  const entries = await getSettings("vibes");
  const value = (key: string) => entries.find((e) => e.key === key)?.value;
  return resolveVibeSettings({
    cycle: value("vibe_cycle"),
    defaultVibe: value("default_vibe"),
    heroEnabled: value("hero_enabled"),
  });
}

export async function getStoreInfo(): Promise<StoreInfo> {
  "use cache";
  cacheLife("hours");
  cacheTag(SETTINGS_TAG);
  const entries = await getSettings("store");
  const byKey = new Map(entries.map((e) => [e.key as string, e]));
  const text = (key: string): StoreValue => {
    const entry = byKey.get(key);
    return { value: String(entry?.value ?? ""), isPlaceholder: entry?.isPlaceholder ?? true };
  };
  const officer = byKey.get("grievance_officer");
  const officerValue = (officer?.value ?? {}) as Record<string, string | undefined>;
  const officerPart = (field: string): StoreValue => ({
    value: officerValue[field] ?? "",
    isPlaceholder: officer?.isPlaceholder ?? true,
  });
  return {
    brandName: String(byKey.get("brand_name")?.value ?? "IfOnli"),
    legalName: text("legal_name"),
    registeredAddress: text("registered_address"),
    supportEmail: text("support_email"),
    supportPhone: text("support_phone"),
    supportHours: text("support_hours"),
    responseTime: text("response_time"),
    grievance: {
      name: officerPart("name"),
      designation: officerPart("designation"),
      email: officerPart("email"),
      phone: officerPart("phone"),
    },
  };
}
