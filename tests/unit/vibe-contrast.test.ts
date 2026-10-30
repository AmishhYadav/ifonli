import { describe, expect, it } from "vitest";

import { VIBES } from "@/features/vibe/config";
import { composite, contrastRatio, parseColor, relativeLuminance } from "@/features/vibe/contrast";
import { pairsFor, resolveTokens } from "@/features/vibe/tokens";
import { generateTokenCss } from "@/features/vibe/tokens-css";

describe("contrast maths", () => {
  it("black on white is 21:1 in both directions", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 5);
  });

  it("identical colours are 1:1", () => {
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  it("#777 on white is the well-known 4.48 (just under AA)", () => {
    const ratio = contrastRatio("#777777", "#ffffff");
    expect(ratio).toBeGreaterThan(4.47);
    expect(ratio).toBeLessThan(4.49);
  });

  it("#767676 on white just passes AA", () => {
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("relative luminance endpoints", () => {
    expect(relativeLuminance(parseColor("#000"))).toBe(0);
    expect(relativeLuminance(parseColor("#fff"))).toBeCloseTo(1, 10);
  });

  it("parses short, long and alpha hex", () => {
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("#AABBCC")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("#00000080").a).toBeCloseTo(0.502, 2);
    expect(parseColor("#0008").a).toBeCloseTo(0.533, 2);
  });

  it("composites a translucent foreground over the pair background", () => {
    // 50% black over white is mid grey (127.5), not black.
    const mixed = composite(parseColor("#00000080"), parseColor("#ffffff"));
    expect(mixed.r).toBeCloseTo(127, 0);
    expect(contrastRatio("#00000080", "#ffffff")).toBeLessThan(contrastRatio("#000000", "#ffffff"));
    expect(contrastRatio("#00000080", "#ffffff")).toBeCloseTo(
      contrastRatio("#7f7f7f", "#ffffff"),
      1,
    );
  });

  it("rejects unsupported formats loudly", () => {
    for (const bad of [
      "red",
      "rgb(0,0,0)",
      "hsl(0 0% 0%)",
      "#12",
      "#12345",
      "#gggggg",
      "oklch(0.5 0.1 20)",
      "",
    ]) {
      expect(() => parseColor(bad), bad).toThrow(/Unsupported colour format/);
    }
  });

  it("rejects a translucent background", () => {
    expect(() => contrastRatio("#000000", "#ffffff80")).toThrow(/opaque/);
  });
});

describe("token palettes", () => {
  for (const vibe of ["base", ...VIBES] as const) {
    it(`${vibe}: every declared pair meets its minimum`, () => {
      const { palette } = resolveTokens(vibe);
      for (const pair of pairsFor(vibe)) {
        const ratio = contrastRatio(palette[pair.fg], palette[pair.bg]);
        expect(ratio, `${vibe} ${pair.label}`).toBeGreaterThanOrEqual(pair.min);
      }
    });
  }

  it("covers the required text and UI pairs in every vibe", () => {
    for (const vibe of VIBES) {
      const labels = pairsFor(vibe).map((p) => p.label);
      for (const required of [
        "ink on bg",
        "ink on surface",
        "ink-muted on bg",
        "ink-muted on surface",
        "on-accent on accent",
        "price on bg",
        "sale on bg",
        "danger on bg",
        "link on bg",
        "border on bg",
        "focus-ring on bg",
        "focus-ring on surface",
        "accent on bg",
      ]) {
        expect(labels, vibe).toContain(required);
      }
    }
  });

  it("gothic and funky carry extra pairs", () => {
    expect(pairsFor("gothic").length).toBeGreaterThan(pairsFor("cute").length);
    expect(pairsFor("funky").length).toBeGreaterThan(pairsFor("cute").length);
  });
});

describe("generated token CSS", () => {
  const css = generateTokenCss();

  it("emits base, the five vibes and the buy scope", () => {
    expect(Object.keys(css).sort()).toEqual(
      [
        "base.css",
        "bold.css",
        "buy.css",
        "cute.css",
        "funky.css",
        "gothic.css",
        "overthinking.css",
      ].sort(),
    );
  });

  it("scopes base on :root, vibes on [data-vibe] and buy on [data-vibe-scope]", () => {
    expect(css["base.css"]).toContain(":root {");
    for (const vibe of VIBES) expect(css[`${vibe}.css`]).toContain(`[data-vibe="${vibe}"] {`);
    expect(css["buy.css"]).toContain('[data-vibe-scope="buy"] {');
  });

  it("buy scope resets shape tokens only, never palette", () => {
    expect(css["buy.css"]).toContain("--radius-card:");
    expect(css["buy.css"]).toContain("--font-display: var(--font-body)");
    expect(css["buy.css"]).not.toContain("--bg:");
    expect(css["buy.css"]).not.toContain("--ink:");
  });

  it("exactly one visibility flag per vibe is shown", () => {
    for (const vibe of VIBES) {
      const shown = css[`${vibe}.css`]!.match(/--dv-\w+: contents;/g) ?? [];
      expect(shown).toEqual([`--dv-${vibe}: contents;`]);
    }
  });
});
