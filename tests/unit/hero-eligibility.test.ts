import { describe, expect, it } from "vitest";

import { isLowEnd, shouldEnhance } from "@/features/hero/stage/eligibility";

describe("when the poster may be enhanced with the animation", () => {
  const ok = { reducedMotion: false, saveData: false };

  it("enhances on a normal connection with motion allowed", () => {
    expect(shouldEnhance(ok)).toBe(true);
    expect(shouldEnhance({ ...ok, effectiveType: "4g" })).toBe(true);
    expect(shouldEnhance({ ...ok, effectiveType: "3g" })).toBe(true);
    expect(shouldEnhance({ ...ok, effectiveType: undefined })).toBe(true);
  });

  it("never enhances on reduced motion", () => {
    expect(shouldEnhance({ ...ok, reducedMotion: true })).toBe(false);
  });

  it("never enhances on data saver", () => {
    expect(shouldEnhance({ ...ok, saveData: true })).toBe(false);
  });

  it("never enhances on 2g-class connections", () => {
    expect(shouldEnhance({ ...ok, effectiveType: "2g" })).toBe(false);
    expect(shouldEnhance({ ...ok, effectiveType: "slow-2g" })).toBe(false);
  });

  it("skips low-end hardware: 2 GB or less, or 4 cores or fewer together with 4 GB or less", () => {
    expect(shouldEnhance({ ...ok, memoryGb: 2 })).toBe(false);
    expect(shouldEnhance({ ...ok, memoryGb: 1, cores: 8 })).toBe(false);
    expect(shouldEnhance({ ...ok, memoryGb: 4, cores: 4 })).toBe(false);
    expect(shouldEnhance({ ...ok, memoryGb: 4, cores: 2 })).toBe(false);
  });

  it("keeps the animation for normal hardware and for browsers that do not report it", () => {
    expect(shouldEnhance({ ...ok, memoryGb: 4, cores: 8 })).toBe(true); // mid-range phone
    expect(shouldEnhance({ ...ok, memoryGb: 8, cores: 2 })).toBe(true); // small CI runner
    expect(shouldEnhance({ ...ok, cores: 2 })).toBe(true); // no deviceMemory (Safari, Firefox)
    expect(shouldEnhance({ ...ok, memoryGb: 4 })).toBe(true); // cores unknown
    expect(isLowEnd({})).toBe(false);
  });
});
