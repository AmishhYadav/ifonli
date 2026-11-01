/** Conditions under which the static poster may be enhanced with the animated stage (plan section 9). */

export interface EnvSignals {
  reducedMotion: boolean;
  saveData: boolean;
  /** `navigator.connection.effectiveType`, when the browser exposes it. */
  effectiveType?: string | undefined;
  /** `navigator.hardwareConcurrency`, when known. */
  cores?: number | undefined;
  /** `navigator.deviceMemory` in GB (Chromium only, capped at 8), when known. */
  memoryGb?: number | undefined;
}

const SLOW_TYPES = new Set(["slow-2g", "2g"]);

/**
 * Low-end hardware: the 56-tile GSAP stage would cost more main-thread time (and battery) than it is worth, and the
 * static poster is the designed fallback. Deliberately conservative so a normal laptop, a modern phone or a small
 * CI runner (few cores but plenty of memory) still gets the animation: either 2 GB of memory or less, or BOTH 4 cores
 * or fewer and 4 GB or less. Browsers that do not expose a signal (Safari, Firefox) are never treated as low-end.
 */
export function isLowEnd(env: Pick<EnvSignals, "cores" | "memoryGb">): boolean {
  const { cores, memoryGb } = env;
  if (memoryGb !== undefined && memoryGb <= 2) return true;
  return memoryGb !== undefined && memoryGb <= 4 && cores !== undefined && cores <= 4;
}

/** Pure decision: false for reduced motion, data saver, a 2g-class connection, or low-end hardware. */
export function shouldEnhance(env: EnvSignals): boolean {
  if (env.reducedMotion) return false;
  if (env.saveData) return false;
  if (env.effectiveType && SLOW_TYPES.has(env.effectiveType)) return false;
  if (isLowEnd(env)) return false;
  return true;
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

export function readEnv(): EnvSignals {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return {
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    saveData: connection?.saveData === true,
    effectiveType: connection?.effectiveType,
    cores: navigator.hardwareConcurrency || undefined,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  };
}
