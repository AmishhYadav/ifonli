import { describe, expect, it } from "vitest";

import { shouldEnhance } from "@/features/hero/stage/eligibility";

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
});
