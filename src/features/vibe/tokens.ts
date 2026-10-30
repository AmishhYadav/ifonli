/**
 * Design token source of truth. `scripts/build-tokens.ts` turns this file into
 * src/styles/tokens/*.css; `scripts/contrast-check.ts` validates the contrast pairs below.
 * This is the ONLY place raw colour values may live (enforced by ESLint for components).
 *
 * Two groups (docs/PLAN.md section 8.1):
 *  - palette: always applied, including Buy pages (`data-vibe-scope="buy"`)
 *  - shape/type/texture: reset to base under `data-vibe-scope="buy"`
 */
import type { Vibe } from "./config";

export const PALETTE_KEYS = [
  "bg",
  "surface",
  "surface-2",
  "ink",
  "ink-muted",
  "accent",
  "on-accent",
  "accent-2",
  "accent-3",
  "border",
  "focus-ring",
  "success",
  "warning",
  "danger",
  "price",
  "sale",
  "link",
  "texture-ink",
  "texture-opacity",
] as const;

export const SHAPE_KEYS = [
  "font-display",
  "display-weight",
  "display-tracking",
  "display-stretch",
  "display-filter",
  "radius-card",
  "radius-button",
  "radius-input",
  "border-w",
  "shadow-card",
  "shadow-button",
  "icon-stroke",
  "icon-linecap",
  "icon-linejoin",
  "icon-filter",
  "hand-scale",
  "texture-url",
  "texture-size",
  "cursor",
  "motion-ease",
  "motion-dur",
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type ShapeKey = (typeof SHAPE_KEYS)[number];
export type PaletteTokens = Record<PaletteKey, string>;
export type ShapeTokens = Record<ShapeKey, string>;

export interface VibeTokens {
  palette: Partial<PaletteTokens>;
  shape: Partial<ShapeTokens>;
}

export interface ResolvedTokens {
  palette: PaletteTokens;
  shape: ShapeTokens;
}

/* ------------------------------------------------------------------ base */

export const base: ResolvedTokens = {
  palette: {
    bg: "#FFFFFF",
    surface: "#FFFFFF",
    "surface-2": "#F4F4F5",
    ink: "#18181B",
    "ink-muted": "#52525B",
    accent: "#3B4BD8",
    "on-accent": "#FFFFFF",
    "accent-2": "#FACC15",
    "accent-3": "#A5B4FC",
    border: "#8A8A94",
    "focus-ring": "#3B4BD8",
    success: "#15803D",
    warning: "#92400E",
    danger: "#B91C1C",
    price: "#18181B",
    sale: "#B91C1C",
    link: "#3B4BD8",
    "texture-ink": "#18181B",
    "texture-opacity": "0",
  },
  shape: {
    // Base display font is the shared body font, so buy pages need no extra font download.
    "font-display": "var(--font-body)",
    "display-weight": "700",
    "display-tracking": "-0.01em",
    "display-stretch": "100%",
    "display-filter": "none",
    "radius-card": "12px",
    "radius-button": "8px",
    "radius-input": "8px",
    "border-w": "1px",
    "shadow-card": "0 1px 2px color-mix(in srgb, var(--ink) 14%, transparent)",
    "shadow-button": "none",
    "icon-stroke": "2",
    "icon-linecap": "round",
    "icon-linejoin": "round",
    "icon-filter": "none",
    "hand-scale": "1",
    "texture-url": "none",
    "texture-size": "64px",
    cursor: "auto",
    "motion-ease": "cubic-bezier(0.2, 0.8, 0.2, 1)",
    "motion-dur": "200ms",
  },
};

/* ----------------------------------------------------------------- vibes */

export const vibes: Record<Vibe, VibeTokens> = {
  cute: {
    palette: {
      bg: "#FFF4F8",
      surface: "#FFFFFF",
      "surface-2": "#FFE6F0",
      ink: "#3B2340",
      "ink-muted": "#6E4F73",
      accent: "#C2185B",
      "on-accent": "#FFFFFF",
      "accent-2": "#FFE08A", // butter
      "accent-3": "#D8C7FF", // lavender
      border: "#B96A8F",
      "focus-ring": "#6A1B9A",
      success: "#1B7A4B",
      warning: "#8A5300",
      danger: "#B00020",
      price: "#3B2340",
      sale: "#C2185B",
      link: "#C2185B",
      "texture-ink": "#C2185B",
      "texture-opacity": "0.1",
    },
    shape: {
      "font-display": '"Fredoka", "Fredoka Fallback", ui-rounded, sans-serif',
      "display-weight": "600",
      "display-tracking": "0",
      "radius-card": "24px",
      "radius-button": "9999px",
      "radius-input": "16px",
      "border-w": "2px",
      "shadow-card": "0 8px 24px color-mix(in srgb, var(--accent) 18%, transparent)",
      "shadow-button": "0 4px 0 color-mix(in srgb, var(--accent) 45%, transparent)",
      "icon-stroke": "2",
      "texture-url": 'url("/vibe/textures/cute.svg")',
      "texture-size": "192px 192px",
      "motion-ease": "cubic-bezier(0.34, 1.4, 0.64, 1)",
      "motion-dur": "260ms",
    },
  },

  bold: {
    palette: {
      bg: "#FFFFFF",
      surface: "#FFFFFF",
      "surface-2": "#EFEFEF",
      ink: "#0A0A0A",
      "ink-muted": "#454545",
      accent: "#E10600",
      "on-accent": "#FFFFFF",
      "accent-2": "#FFD400", // yellow block
      "accent-3": "#0047FF", // blue block
      border: "#0A0A0A",
      "focus-ring": "#0047FF",
      success: "#0B7A3B",
      warning: "#8A5A00",
      danger: "#C40000",
      price: "#0A0A0A",
      sale: "#C40500",
      link: "#0047FF",
      "texture-ink": "#0A0A0A",
      "texture-opacity": "0.06",
    },
    shape: {
      "font-display": '"Archivo", "Archivo Fallback", Impact, sans-serif',
      "display-weight": "900",
      "display-tracking": "-0.02em",
      "display-stretch": "125%",
      "radius-card": "0px",
      "radius-button": "0px",
      "radius-input": "0px",
      "border-w": "3px",
      "shadow-card": "6px 6px 0 var(--ink)",
      "shadow-button": "4px 4px 0 var(--ink)",
      "icon-stroke": "2.5",
      "icon-linecap": "square",
      "icon-linejoin": "miter",
      "texture-url": 'url("/vibe/textures/bold.svg")',
      "texture-size": "96px 96px",
      "motion-ease": "cubic-bezier(0.7, 0, 0.2, 1)",
      "motion-dur": "140ms",
    },
  },

  overthinking: {
    palette: {
      bg: "#F7F5EE",
      surface: "#FDFCF7",
      "surface-2": "#ECE9DC",
      ink: "#2B3A4A",
      "ink-muted": "#506074",
      accent: "#3D5A80",
      "on-accent": "#FFFFFF",
      "accent-2": "#FFF59D", // highlighter
      "accent-3": "#E27D7D", // margin red
      border: "#7A889A",
      "focus-ring": "#3D5A80",
      success: "#2E7D32",
      warning: "#8A5300",
      danger: "#B3261E",
      price: "#2B3A4A",
      sale: "#B3261E",
      link: "#3D5A80",
      "texture-ink": "#3D5A80",
      "texture-opacity": "0.35",
    },
    shape: {
      "font-display": '"Kalam", "Kalam Fallback", "Comic Sans MS", cursive',
      "display-weight": "700",
      "display-tracking": "0",
      "radius-card": "18px 6px 16px 5px / 6px 16px 5px 18px",
      "radius-button": "14px 4px 12px 5px / 5px 12px 4px 14px",
      "radius-input": "10px 3px 9px 4px / 4px 9px 3px 10px",
      "border-w": "2px",
      "shadow-card": "3px 4px 0 color-mix(in srgb, var(--ink) 22%, transparent)",
      "shadow-button": "2px 3px 0 color-mix(in srgb, var(--ink) 30%, transparent)",
      "icon-stroke": "1.75",
      "icon-filter": "url(#wobble)",
      "texture-url": 'url("/vibe/textures/overthinking.svg")',
      "texture-size": "1024px 256px",
      "motion-ease": "cubic-bezier(0.45, 0.05, 0.55, 0.95)",
      "motion-dur": "320ms",
    },
  },

  gothic: {
    palette: {
      bg: "#0E0B10",
      surface: "#1A1420",
      "surface-2": "#251C2C",
      ink: "#EDE6F0",
      "ink-muted": "#B3A6BD",
      accent: "#B93560", // oxblood, lifted so it holds 3:1 against the near-black bg
      "on-accent": "#FFFFFF",
      "accent-2": "#5B3A7A", // violet
      "accent-3": "#E0A23A", // candle gold
      border: "#7A6688",
      "focus-ring": "#F2B8CC",
      success: "#5CC48A",
      warning: "#E0A23A",
      danger: "#FF8A98",
      price: "#EDE6F0",
      sale: "#FF8FA8",
      link: "#E58BA9", // rose
      "texture-ink": "#E58BA9",
      "texture-opacity": "0.07",
    },
    shape: {
      "font-display": '"Grenze Gotisch", "Grenze Gotisch Fallback", "Times New Roman", serif',
      "display-weight": "700",
      "display-tracking": "0.02em",
      "radius-card": "2px",
      "radius-button": "2px",
      "radius-input": "2px",
      "border-w": "1px",
      "shadow-card": "0 0 28px color-mix(in srgb, var(--accent) 35%, transparent)",
      "shadow-button": "0 0 14px color-mix(in srgb, var(--accent) 55%, transparent)",
      "icon-stroke": "1.25",
      "icon-linecap": "butt",
      "icon-linejoin": "miter",
      "hand-scale": "1.2",
      "texture-url": 'url("/vibe/textures/gothic.svg")',
      "texture-size": "96px 96px",
      "motion-ease": "cubic-bezier(0.4, 0, 0.2, 1)",
      "motion-dur": "300ms",
    },
  },

  funky: {
    palette: {
      bg: "#FFF1D6",
      surface: "#FFFAEE",
      "surface-2": "#FFE2A8",
      ink: "#2A1B3D",
      "ink-muted": "#5E4A75",
      accent: "#E55A1C", // orange
      "on-accent": "#190E26",
      "accent-2": "#00B3A4", // teal
      "accent-3": "#E83F8C", // magenta
      border: "#7A5C9A",
      "focus-ring": "#5B2A9D",
      success: "#0B7A55",
      warning: "#8A5300",
      danger: "#B3122F",
      price: "#2A1B3D",
      sale: "#B3122F",
      link: "#A2185E",
      "texture-ink": "#2A1B3D",
      "texture-opacity": "0.05",
    },
    shape: {
      "font-display": '"Shrikhand", "Shrikhand Fallback", "Brush Script MT", cursive',
      "display-weight": "400",
      "display-tracking": "0.01em",
      "display-filter": "url(#warp)",
      "radius-card": "28px",
      "radius-button": "9999px",
      "radius-input": "14px",
      "border-w": "2px",
      "shadow-card": "6px 6px 0 var(--accent-2), 12px 12px 0 var(--accent-3)",
      "shadow-button": "3px 3px 0 var(--accent-2), 6px 6px 0 var(--accent-3)",
      "icon-stroke": "2.5",
      "texture-url": 'url("/vibe/textures/funky.svg")',
      "texture-size": "128px 96px",
      "motion-ease": "cubic-bezier(0.34, 1.56, 0.64, 1)",
      "motion-dur": "280ms",
    },
  },
};

/** Vibe override ?? base, for every token. */
export function resolveTokens(vibe: Vibe | "base"): ResolvedTokens {
  if (vibe === "base") return base;
  const v = vibes[vibe];
  return {
    palette: { ...base.palette, ...v.palette },
    shape: { ...base.shape, ...v.shape },
  };
}

/* ------------------------------------------------------- contrast pairs */

export interface ContrastPair {
  fg: PaletteKey;
  bg: PaletteKey;
  /** 4.5 for text, 3 for UI components / graphical objects. */
  min: 4.5 | 3;
  label: string;
}

const text = (fg: PaletteKey, bg: PaletteKey): ContrastPair => ({
  fg,
  bg,
  min: 4.5,
  label: `${fg} on ${bg}`,
});
const ui = (fg: PaletteKey, bg: PaletteKey): ContrastPair => ({
  fg,
  bg,
  min: 3,
  label: `${fg} on ${bg}`,
});

/** Pairs every vibe (and base) must satisfy. */
export const COMMON_PAIRS: readonly ContrastPair[] = [
  text("ink", "bg"),
  text("ink", "surface"),
  text("ink", "surface-2"),
  text("ink-muted", "bg"),
  text("ink-muted", "surface"),
  text("ink-muted", "surface-2"),
  text("on-accent", "accent"),
  text("ink", "accent-2"),
  text("price", "bg"),
  text("price", "surface"),
  text("sale", "bg"),
  text("sale", "surface"),
  text("danger", "bg"),
  text("danger", "surface"),
  text("success", "bg"),
  text("warning", "bg"),
  text("link", "bg"),
  text("link", "surface"),
  ui("border", "bg"),
  ui("focus-ring", "bg"),
  ui("focus-ring", "surface"),
  ui("accent", "bg"),
];

/** Extra pairs for the vibes that stress contrast (plan section 13). */
export const EXTRA_PAIRS: Partial<Record<Vibe, readonly ContrastPair[]>> = {
  gothic: [
    ui("focus-ring", "surface-2"),
    ui("border", "surface"),
    ui("accent", "surface"),
    text("success", "surface"),
    text("warning", "surface"),
    text("link", "surface-2"),
  ],
  funky: [
    ui("focus-ring", "surface-2"),
    ui("border", "surface"),
    ui("accent", "surface"),
    text("link", "surface-2"),
    text("sale", "surface-2"),
    text("ink", "bg"),
  ],
  bold: [ui("border", "surface"), ui("accent", "surface")],
};

export function pairsFor(vibe: Vibe | "base"): ContrastPair[] {
  return [...COMMON_PAIRS, ...(vibe === "base" ? [] : (EXTRA_PAIRS[vibe] ?? []))];
}
