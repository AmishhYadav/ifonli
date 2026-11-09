import { describe, expect, it } from "vitest";

import { BOOT_SCRIPT } from "@/features/landing/Boot";
import { isLowPower, type PowerSignals } from "@/features/landing/power";

describe("isLowPower", () => {
  it("is low on four cores or fewer, 4 GB or less, Save-Data or a 2g-class connection", () => {
    expect(isLowPower({ cores: 4 })).toBe(true);
    expect(isLowPower({ cores: 2, memoryGb: 8 })).toBe(true);
    expect(isLowPower({ memoryGb: 4 })).toBe(true);
    expect(isLowPower({ cores: 8, memoryGb: 2 })).toBe(true);
    expect(isLowPower({ cores: 8, memoryGb: 8, saveData: true })).toBe(true);
    expect(isLowPower({ cores: 8, memoryGb: 8, effectiveType: "slow-2g" })).toBe(true);
  });

  it("is capable on a normal phone or laptop, and when the browser reports nothing", () => {
    expect(isLowPower({ cores: 8, memoryGb: 8, effectiveType: "4g" })).toBe(false);
    expect(isLowPower({ cores: 6 })).toBe(false);
    expect(isLowPower({})).toBe(false);
    expect(isLowPower({ cores: 0, memoryGb: 0 })).toBe(false); // 0 means "unknown"
  });
});

/** The inline script in Boot.tsx must reach the same verdict as isLowPower for the same signals. */
function bootVerdict(signals: PowerSignals): { flagged: boolean; motion: string | undefined } {
  const attrs = new Set<string>();
  const dataset: Record<string, string> = {};
  const root = { dataset };
  const navigator = {
    hardwareConcurrency: signals.cores,
    deviceMemory: signals.memoryGb,
    connection:
      signals.saveData === undefined && signals.effectiveType === undefined
        ? undefined
        : { saveData: signals.saveData, effectiveType: signals.effectiveType },
  };
  const document = {
    getElementById: () => root,
    documentElement: { setAttribute: (name: string) => attrs.add(name) },
  };
  new Function("navigator", "document", "matchMedia", "addEventListener", BOOT_SCRIPT)(
    navigator,
    document,
    () => ({ matches: false }),
    () => {},
  );
  return { flagged: attrs.has("data-low-power"), motion: dataset.motion };
}

describe("the boot script's low-power flag", () => {
  const cases: PowerSignals[] = [
    { cores: 4 },
    { cores: 2, memoryGb: 8 },
    { memoryGb: 4 },
    { cores: 8, memoryGb: 2 },
    { cores: 8, memoryGb: 8, saveData: true },
    { cores: 8, memoryGb: 8, effectiveType: "slow-2g" },
    { cores: 8, memoryGb: 8, effectiveType: "4g" },
    { cores: 6 },
    { cores: 8, memoryGb: 8 },
    {},
    { cores: 0, memoryGb: 0 },
  ];

  it.each(cases)("agrees with isLowPower for %j", (signals) => {
    expect(bootVerdict(signals).flagged).toBe(isLowPower(signals));
  });

  it("still switches the choreography layout on", () => {
    expect(bootVerdict({ cores: 8, memoryGb: 8 }).motion).toBe("on");
    expect(bootVerdict({ cores: 2 }).motion).toBe("on");
  });
});
