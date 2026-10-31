/** Conditions under which the static poster may be enhanced with the animated stage (plan section 9). */

export interface EnvSignals {
  reducedMotion: boolean;
  saveData: boolean;
  /** `navigator.connection.effectiveType`, when the browser exposes it. */
  effectiveType?: string | undefined;
}

const SLOW_TYPES = new Set(["slow-2g", "2g"]);

/** Pure decision: false for reduced motion, data saver, or a 2g-class connection. */
export function shouldEnhance(env: EnvSignals): boolean {
  if (env.reducedMotion) return false;
  if (env.saveData) return false;
  if (env.effectiveType && SLOW_TYPES.has(env.effectiveType)) return false;
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
  };
}
