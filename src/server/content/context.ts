import {
  SETTINGS,
  SETTING_KEYS,
  isRequiredForLaunch,
  type SettingKey,
} from "@/server/services/settings-registry";

import type { TemplateContext } from "./render-template";

export interface ContextEntry {
  key: SettingKey;
  value: unknown;
  isPlaceholder: boolean;
}

/**
 * Template context from stored settings (pure). A key `blocks` publishing when it is still a placeholder
 * AND required for launch (honouring `requiredUnless`, so return-policy copy only matters when returns exist).
 */
export function buildTemplateContext(entries: readonly ContextEntry[]): TemplateContext {
  const byKey = new Map(entries.map((e) => [e.key as string, e]));
  const valueOf = (key: string) => byKey.get(key)?.value;
  const ctx: Record<string, TemplateContext[string]> = {};
  for (const key of SETTING_KEYS) {
    const entry = byKey.get(key);
    if (!entry) continue;
    const def = SETTINGS[key];
    ctx[key] = {
      value: entry.value,
      format: def.format,
      blocking: entry.isPlaceholder && isRequiredForLaunch(def, valueOf),
    };
  }
  return ctx;
}
