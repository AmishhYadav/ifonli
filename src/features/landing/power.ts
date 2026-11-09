/**
 * Whether this device should get the cheaper landing page: no background parallax, no frosted-glass pills. The same
 * decision is made before first paint by the inline script in Boot.tsx (which sets `data-low-power` on <html>); this
 * is the readable, unit-tested copy of it, and the two are kept in step by tests/unit/landing-power.test.ts.
 *
 * Low power means: four cores or fewer, or 4 GB of memory or less (`navigator.deviceMemory`, Chromium only), or Data
 * Saver / a 2g-class connection. It is deliberately broader than the hero's `isLowEnd` (which gates a whole 56-tile
 * animation): here only decoration is dropped and the choreography itself stays. A browser that exposes none of these
 * signals (Firefox) is treated as capable.
 */
export interface PowerSignals {
  cores?: number | undefined;
  memoryGb?: number | undefined;
  saveData?: boolean | undefined;
  effectiveType?: string | undefined;
}

export function isLowPower({ cores, memoryGb, saveData, effectiveType }: PowerSignals): boolean {
  // 0 is "unknown" (some browsers report it), the same as absent.
  if (cores !== undefined && cores > 0 && cores <= 4) return true;
  if (memoryGb !== undefined && memoryGb > 0 && memoryGb <= 4) return true;
  if (saveData === true) return true;
  return effectiveType !== undefined && effectiveType.includes("2g");
}

/** The attribute Boot.tsx sets on <html>; CSS and the motion code both read it. */
export const LOW_POWER_ATTR = "data-low-power";

export function hasLowPowerFlag(): boolean {
  return document.documentElement.hasAttribute(LOW_POWER_ATTR);
}
