import { DEFAULT_VIBE, DEFAULT_VIBE_CYCLE, isVibe, type DefaultVibeSetting, type Vibe } from "./config";

export interface VibeSettings {
  cycle: Vibe[];
  defaultVibe: DefaultVibeSetting;
  /** False: only the static poster hero is shown (the animated stage is never mounted). */
  heroEnabled: boolean;
}

/**
 * Turns the raw admin values (`vibe_cycle`, `default_vibe`, `hero_enabled`) into safe settings. Unknown
 * slugs are dropped, an empty cycle falls back to all five vibes, and a default that is not in the cycle
 * (say "gothic" while the cycle is cute, bold) becomes the cycle's first vibe: the no-flash head script
 * looks every vibe up in the cycle, so a default outside it would break its font preload and theme colour.
 */
export function resolveVibeSettings(raw: {
  cycle: unknown;
  defaultVibe: unknown;
  heroEnabled: unknown;
}): VibeSettings {
  const filtered: Vibe[] = Array.isArray(raw.cycle) ? (raw.cycle as unknown[]).filter(isVibe) : [];
  const cycle = filtered.length > 0 ? [...new Set(filtered)] : [...DEFAULT_VIBE_CYCLE];
  const wanted: DefaultVibeSetting =
    raw.defaultVibe === "random" ? "random" : isVibe(raw.defaultVibe) ? raw.defaultVibe : DEFAULT_VIBE;
  const defaultVibe: DefaultVibeSetting =
    wanted === "random" || cycle.includes(wanted) ? wanted : (cycle[0] ?? DEFAULT_VIBE);
  return { cycle, defaultVibe, heroEnabled: raw.heroEnabled !== false };
}
