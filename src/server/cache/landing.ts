import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { getSettings } from "@/server/services/settings";

import { SETTINGS_TAG } from "./tags";

/**
 * The store facts the landing page quotes, read from the same settings the cart and checkout enforce so the
 * story never drifts from the store. `null` means "not set up yet" (still a registry placeholder).
 */
export interface LandingFacts {
  /** Whole rupees at or above which shipping is free, or null when free shipping is not a threshold offer. */
  freeShippingRupees: number | null;
  /** Cash on delivery is switched on. */
  codEnabled: boolean;
  /** Hours after delivery to report a damaged item, or null when unset. */
  damageWindowHours: number | null;
}

/** What the owner told us the store offers; used when settings cannot be read (never invents new claims). */
export const FALLBACK_LANDING_FACTS: LandingFacts = {
  freeShippingRupees: 299,
  codEnabled: true,
  damageWindowHours: 48,
};

export async function getLandingFacts(): Promise<LandingFacts> {
  "use cache";
  cacheLife("hours");
  cacheTag(SETTINGS_TAG);
  const [shipping, cod, returns] = await Promise.all([
    getSettings("shipping"),
    getSettings("cod"),
    getSettings("returns"),
  ]);
  const pick = (entries: Awaited<ReturnType<typeof getSettings>>, key: string) =>
    entries.find((e) => e.key === key);

  const threshold = pick(shipping, "free_threshold");
  const codEntry = pick(cod, "cod_enabled");
  const window = pick(returns, "damaged_claim_window_hours");

  const thresholdPaise = typeof threshold?.value === "number" ? threshold.value : 0;
  const windowHours = typeof window?.value === "number" ? window.value : 0;
  return {
    freeShippingRupees:
      threshold && !threshold.isPlaceholder && thresholdPaise > 0 ? Math.round(thresholdPaise / 100) : null,
    codEnabled: Boolean(codEntry && !codEntry.isPlaceholder && codEntry.value === true),
    damageWindowHours: window && !window.isPlaceholder && windowHours > 0 ? windowHours : null,
  };
}
