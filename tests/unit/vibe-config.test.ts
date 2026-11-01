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
import {
  ART_GRADIENTS,
  PALETTE_KEYS,
  SHAPE_KEYS,
  base,
  resolveTokens,
  vibes,
} from "@/features/vibe/tokens";

describe("nextVibe", () => {
  it("follows the hand-button order cute > gothic > funky > bold > cute", () => {
    expect(nextVibe("cute")).toBe("gothic");
    expect(nextVibe("gothic")).toBe("funky");
    expect(nextVibe("funky")).toBe("bold");
    expect(nextVibe("bold")).toBe("cute");
  });

  it("lists vibes in nav order cute, funky, bold, gothic", () => {
    expect(VIBES).toEqual(["cute", "funky", "bold", "gothic"]);
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
  it("default cycle contains every vibe in the hand-button order, default vibe is cute", () => {
    expect([...DEFAULT_VIBE_CYCLE]).toEqual(["cute", "gothic", "funky", "bold"]);
    expect([...DEFAULT_VIBE_CYCLE].sort()).toEqual([...VIBES].sort());
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

  it("uses the demo's names", () => {
    expect(VIBE_NAMES).toEqual({
      cute: "Mochi",
      funky: "Chaos Cabinet",
      bold: "Unapologetic",
      gothic: "After the Dark",
    });
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

  it("every theme is soft: pill buttons, rounded cards, no textures, no offset shadows", () => {
    for (const v of ["base", ...VIBES] as const) {
      const { shape, palette } = resolveTokens(v);
      expect(shape["radius-button"], v).toBe("9999px");
      expect(shape["texture-url"], v).toBe("none");
      expect(palette["texture-opacity"], v).toBe("0");
      expect(shape["display-filter"], v).toBe("none");
      expect(shape["icon-filter"], v).toBe("none");
      expect(parseInt(shape["radius-card"], 10), v).toBeGreaterThanOrEqual(16);
      // Hard offset shadows look like "6px 6px 0 colour": no unblurred, non-zero-offset layers.
      expect(shape["shadow-card"], v).not.toMatch(/(^|, )[1-9]\d*px [1-9]\d*px 0 /);
      expect(shape["shadow-button"], v).not.toMatch(/(^|, )[1-9]\d*px [1-9]\d*px 0 /);
    }
  });

  it("every theme has a soft hairline and a hand skin tone; product art has two stops per vibe", () => {
    for (const v of VIBES) {
      expect(vibes[v].palette.hairline, v).toMatch(/^#[0-9A-F]{6}$/);
      expect(vibes[v].palette.hand, v).toMatch(/^#[0-9A-F]{6}$/);
      expect(ART_GRADIENTS[v]).toHaveLength(2);
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
