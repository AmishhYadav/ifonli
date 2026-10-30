import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIBE,
  DEFAULT_VIBE_CYCLE,
  DISPLAY_FONT_FILES,
  DISPLAY_FONT_LOAD,
  VIBES,
  VIBE_NAMES,
  isVibe,
  nextVibe,
} from "@/features/vibe/config";
import { PALETTE_KEYS, SHAPE_KEYS, base, resolveTokens, vibes } from "@/features/vibe/tokens";

describe("nextVibe", () => {
  it("follows the fixed order cute > bold > overthinking > gothic > funky > cute", () => {
    expect(VIBES).toEqual(["cute", "bold", "overthinking", "gothic", "funky"]);
    expect(nextVibe("cute")).toBe("bold");
    expect(nextVibe("bold")).toBe("overthinking");
    expect(nextVibe("overthinking")).toBe("gothic");
    expect(nextVibe("gothic")).toBe("funky");
    expect(nextVibe("funky")).toBe("cute");
  });

  it("wraps around a custom cycle and skips vibes that are not in it", () => {
    const cycle = ["gothic", "cute"] as const;
    expect(nextVibe("gothic", cycle)).toBe("cute");
    expect(nextVibe("cute", cycle)).toBe("gothic");
    expect(nextVibe("bold", cycle)).toBe("gothic");
  });

  it("a one-vibe cycle maps to itself", () => {
    expect(nextVibe("funky", ["funky"])).toBe("funky");
  });

  it("returns every vibe exactly once in a full lap", () => {
    const seen = new Set<string>();
    let v = DEFAULT_VIBE;
    for (let i = 0; i < VIBES.length; i++) {
      seen.add(v);
      v = nextVibe(v);
    }
    expect(seen.size).toBe(VIBES.length);
    expect(v).toBe(DEFAULT_VIBE);
  });
});

describe("config invariants", () => {
  it("default cycle contains every vibe, default vibe is cute", () => {
    expect([...DEFAULT_VIBE_CYCLE]).toEqual([...VIBES]);
    expect(DEFAULT_VIBE).toBe("cute");
  });

  it("isVibe accepts only known ids", () => {
    for (const v of VIBES) expect(isVibe(v)).toBe(true);
    for (const bad of ["", "Cute", "random", null, undefined, 3]) expect(isVibe(bad)).toBe(false);
  });

  it("every vibe has a name, a display font and a font-load descriptor", () => {
    for (const v of VIBES) {
      expect(VIBE_NAMES[v].length).toBeGreaterThan(0);
      expect(DISPLAY_FONT_FILES[v]).toMatch(/^\/fonts\/.+\.woff2$/);
      expect(DISPLAY_FONT_LOAD[v]).toMatch(/1em "/);
    }
    expect(new Set(Object.values(DISPLAY_FONT_FILES)).size).toBe(VIBES.length);
  });
});

describe("tokens", () => {
  it("has an override entry for exactly the known vibes", () => {
    expect(Object.keys(vibes).sort()).toEqual([...VIBES].sort());
  });

  it("base defines every palette and shape token", () => {
    for (const k of PALETTE_KEYS) expect(base.palette[k], k).toBeTruthy();
    for (const k of SHAPE_KEYS) expect(base.shape[k], k).toBeTruthy();
  });

  it("vibe overrides only use declared token names", () => {
    for (const v of VIBES) {
      for (const k of Object.keys(vibes[v].palette)) expect(PALETTE_KEYS).toContain(k);
      for (const k of Object.keys(vibes[v].shape)) expect(SHAPE_KEYS).toContain(k);
    }
  });

  it("every vibe overrides the whole palette (no vibe silently inherits base colours)", () => {
    for (const v of VIBES) {
      for (const k of PALETTE_KEYS) {
        expect(resolveTokens(v).palette[k], `${v}.${k}`).toBeTruthy();
        expect(vibes[v].palette[k], `${v}.${k} should be explicit`).toBeDefined();
      }
    }
  });
});
