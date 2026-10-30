/**
 * WCAG 2.x contrast maths. Pure functions, no dependencies, used by scripts/contrast-check.ts and unit tests.
 * Supported colour formats: #RGB, #RGBA, #RRGGBB, #RRGGBBAA. Anything else throws (never guess a colour).
 */

export interface Rgba {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function parseColor(input: string): Rgba {
  const value = input.trim();
  if (!HEX_RE.test(value)) {
    throw new Error(
      `Unsupported colour format "${input}": only #RGB, #RGBA, #RRGGBB and #RRGGBBAA are supported`,
    );
  }
  let hex = value.slice(1);
  if (hex.length <= 4) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
}

/** Composite `fg` over an opaque `bg`. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  if (bg.a !== 1) throw new Error("Background colour must be opaque to composite over it");
  const mix = (f: number, b: number) => f * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: Rgba): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG contrast ratio between a foreground (alpha allowed) and an opaque background. */
export function contrastRatio(foreground: string, background: string): number {
  const bg = parseColor(background);
  if (bg.a !== 1) {
    throw new Error(
      `Background "${background}" has alpha; backgrounds in contrast pairs must be opaque`,
    );
  }
  const fg = composite(parseColor(foreground), bg);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
