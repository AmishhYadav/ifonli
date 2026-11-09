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
  /** Fill of text fields (Input, Textarea, Select): a touch off the surface it sits on; ink and placeholder must read on it. */
  "field",
  "ink",
  "ink-muted",
  "accent",
  "on-accent",
  "accent-2",
  "accent-3",
  /**
   * `border` is the >= 3:1 colour and is ONLY for form-control outlines (inputs, checkboxes, radios, selects).
   * Everything else (dividers, card edges, the header underline) uses the soft `hairline`, which is not
   * contrast-checked.
   */
  "border",
  "hairline",
  /** Skin tone of the hand logo, per theme. */
  "hand",
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

/** Shape tokens shared by every theme: soft curves, no hard outlines, no offset shadows, no textures. */
const SOFT_SHAPE = {
  "display-stretch": "100%",
  "display-filter": "none",
  "radius-button": "9999px",
  "border-w": "1px",
  "icon-stroke": "2",
  "icon-linecap": "round",
  "icon-linejoin": "round",
  "icon-filter": "none",
  "hand-scale": "1",
  "texture-url": "none",
  "texture-size": "64px",
  cursor: "auto",
  "motion-ease": "cubic-bezier(0.22, 1, 0.36, 1)",
  "motion-dur": "320ms",
} as const satisfies Partial<ShapeTokens>;

const SHADOW_BUTTON = "0 8px 20px -8px color-mix(in srgb, var(--accent) 55%, transparent)";
const SHADOW_CARD_LIGHT =
  "0 1px 2px color-mix(in srgb, var(--ink) 6%, transparent), 0 12px 32px -12px color-mix(in srgb, var(--ink) 18%, transparent)";
const SHADOW_CARD_DARK =
  "0 16px 40px -16px rgb(0 0 0 / 0.7), inset 0 0 0 1px color-mix(in srgb, var(--ink) 6%, transparent)";

export const base: ResolvedTokens = {
  palette: {
    bg: "#FFFFFF",
    surface: "#FFFFFF",
    "surface-2": "#F4F4F5",
    field: "#F1F1F3",
    ink: "#18181B",
    "ink-muted": "#52525B",
    accent: "#3B4BD8",
    "on-accent": "#FFFFFF",
    "accent-2": "#FACC15",
    "accent-3": "#A5B4FC",
    border: "#8A8A94",
    hairline: "#E7E7EA",
    hand: "#F1D3BC",
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
    ...SOFT_SHAPE,
    // Base display font is the shared body font, so buy pages need no extra font download.
    "font-display": "var(--font-body)",
    "display-weight": "700",
    "display-tracking": "-0.01em",
    "radius-card": "16px",
    "radius-input": "12px",
    "shadow-card": SHADOW_CARD_LIGHT,
    "shadow-button": SHADOW_BUTTON,
  },
};

/* ------------------------------------------------------------ product art */

/**
 * Product-tile gradient stops, keyed by the PRODUCT's vibe (not the active theme), so a Mochi charm keeps its mint
 * tile while the visitor browses in After the Dark. The generator emits them as `--art-<vibe>-a` / `-b` on :root and
 * globals.css exposes `.art-<vibe>`; `.art-none` is the neutral surface-2 to surface tile.
 */
export const ART_GRADIENTS: Record<Vibe, readonly [string, string]> = {
  cute: ["#C3F5DE", "#DBF0FF"],
  funky: ["#D1ED74", "#00EAF4"],
  bold: ["#C20011", "#290B0A"],
  gothic: ["#261A3A", "#05050D"],
};

/* ----------------------------------------------------------------- vibes */

/*
 * Palettes are the demo's colours (OKLCH converted to hex). Where a demo colour failed WCAG AA for its job the hue was
 * kept and only the lightness moved, by the minimum needed (see the "was" comments).
 */
export const vibes: Record<Vibe, VibeTokens> = {
  // Mochi: mint, soft and squishy. Light.
  cute: {
    palette: {
      bg: "#E9FAF2",
      surface: "#F6FEFA",
      "surface-2": "#D8EFDC",
      field: "#E0F3E9",
      ink: "#0C3D3F",
      "ink-muted": "#416E6B", // was #45726F: 4.45:1 on surface-2
      accent: "#1A7F6C", // was #339A83: 3.45:1 under white text
      "on-accent": "#FFFFFF",
      "accent-2": "#F2C6A4", // peach (deepened from the hand skin tone so it reads as a swatch)
      "accent-3": "#A9D8F5", // sky (deepened from the art gradient end)
      border: "#5E8B82", // form controls only
      hairline: "#CDE5D9",
      hand: "#F8D7BE",
      "focus-ring": "#146B5B",
      success: "#1B7A4B",
      warning: "#8A5300",
      danger: "#B00020",
      price: "#0C3D3F",
      sale: "#A85C16", // was #C87A30: 3.1:1
      link: "#1A7F6C",
      "texture-ink": "#1A7F6C",
      "texture-opacity": "0",
    },
    shape: {
      "font-display": '"Fredoka", "Fredoka Fallback", ui-rounded, sans-serif',
      "display-weight": "600",
      "display-tracking": "0",
      "radius-card": "20px",
      "radius-input": "14px",
      "shadow-card": SHADOW_CARD_LIGHT,
      "shadow-button": SHADOW_BUTTON,
    },
  },

  // Unapologetic: rich burgundy with black, bone and amber. Dark, unisex.
  bold: {
    palette: {
      bg: "#4A0F1E",
      surface: "#5C1627",
      "surface-2": "#6E1F32",
      field: "#7A2639",
      ink: "#FBF1F2",
      "ink-muted": "#E9C3C9",
      accent: "#F2B632", // amber; dark text sits on it
      "on-accent": "#1A0509",
      "accent-2": "#1A0509", // near-black (light ink must stay readable on accent-2)
      "accent-3": "#E8D9C5", // bone
      border: "#C98A97", // form controls only
      hairline: "#7E2A3E",
      hand: "#D89F80",
      "focus-ring": "#F9C718",
      success: "#6FD8A0",
      warning: "#F9C718",
      danger: "#FFA3AE",
      price: "#FBF1F2",
      sale: "#F9C718",
      link: "#FFC4CB",
      "texture-ink": "#F2B632",
      "texture-opacity": "0",
    },
    shape: {
      "font-display": '"Bebas Neue", "Bebas Neue Fallback", Impact, sans-serif',
      "display-weight": "400",
      "display-tracking": "0.02em",
      "radius-card": "20px",
      "radius-input": "14px",
      "shadow-card": SHADOW_CARD_DARK,
      "shadow-button": SHADOW_BUTTON,
    },
  },

  // After the Dark: dark purple-black with a red accent.
  gothic: {
    palette: {
      bg: "#0F0B15",
      surface: "#181322",
      "surface-2": "#241E2E",
      field: "#2B2438",
      ink: "#E0DBEA",
      "ink-muted": "#928B9F",
      accent: "#CC272E",
      "on-accent": "#F5F5F5",
      "accent-2": "#5A3F8A", // violet (lifted from the art gradient start)
      "accent-3": "#EF7926", // ember orange
      border: "#6E6480", // form controls only
      hairline: "#302A3B",
      hand: "#D3CDBF",
      "focus-ring": "#C9B8F2",
      success: "#5CC48A",
      warning: "#E0A23A",
      danger: "#FF8A98",
      price: "#E0DBEA",
      sale: "#EF7926",
      link: "#F26B70", // the red lifted to 4.5:1 for link text on the dark surfaces
      "texture-ink": "#CC272E",
      "texture-opacity": "0",
    },
    shape: {
      "font-display": '"Lilita One", "Lilita One Fallback", Arial, sans-serif',
      "display-weight": "400",
      "display-tracking": "0",
      "radius-card": "20px",
      "radius-input": "14px",
      "icon-stroke": "1.75",
      "shadow-card": SHADOW_CARD_DARK,
      "shadow-button": SHADOW_BUTTON,
    },
  },

  // Chaos Cabinet: lemon and mint with an orange accent. Light.
  funky: {
    palette: {
      bg: "#F4F6C8",
      surface: "#FDFEE7",
      "surface-2": "#8FF4E0", // very minty on purpose: chips and tiles, not body text
      field: "#E3FBF4", // pale mint, so a field reads against the lemon page and the cream surface
      ink: "#1C1A46",
      "ink-muted": "#4D5081",
      accent: "#BB4100", // was #DD5400: 3.9:1 under white text
      "on-accent": "#FFFFFF",
      "accent-2": "#8FF4E0", // mint
      "accent-3": "#D1ED74", // lime
      border: "#7478A6", // form controls only
      hairline: "#E3E6B0",
      hand: "#7BD77F",
      "focus-ring": "#3A3DA0",
      success: "#0B6B3A",
      warning: "#8A5300",
      danger: "#B3122F",
      price: "#1C1A46",
      sale: "#007313", // was #008D00: 3.9:1
      link: "#A63800",
      "texture-ink": "#BB4100",
      "texture-opacity": "0",
    },
    shape: {
      "font-display": '"Rubik Glitch", "Rubik Glitch Fallback", "Brush Script MT", cursive',
      "display-weight": "400",
      "display-tracking": "0",
      "radius-card": "20px",
      "radius-input": "14px",
      "shadow-card": SHADOW_CARD_LIGHT,
      "shadow-button": SHADOW_BUTTON,
    },
  },
};

/**
 * The mixed home page: a warm neutral ground with a near-black accent, so the four vibes' colours (cards, art tiles,
 * product pictures) sit on it without any one of them owning the page. Applied to `html[data-mix]` (see MixMode).
 */
export const mix: VibeTokens = {
  palette: {
    bg: "#F6F2EA",
    surface: "#FFFDF9",
    "surface-2": "#ECE6DA",
    field: "#EFE9DE",
    ink: "#1E1B24",
    "ink-muted": "#59545F",
    accent: "#2A2433",
    "on-accent": "#FFFFFF",
    "accent-2": "#F2C6A4",
    "accent-3": "#C9B8F2",
    border: "#85807A",
    hairline: "#E2DACB",
    hand: "#F1D3BC",
    "focus-ring": "#4A3A9A",
    success: "#146C36",
    link: "#4A3A9A",
  },
  shape: {
    "font-display": '"Fredoka", "Fredoka Fallback", ui-rounded, sans-serif',
    "display-weight": "600",
    "display-tracking": "0",
    "radius-card": "20px",
    "radius-input": "14px",
  },
};

/** Vibe override ?? base, for every token. `mix` is the neutral home theme. */
export function resolveTokens(vibe: Vibe | "base" | "mix"): ResolvedTokens {
  if (vibe === "base") return base;
  const v = vibe === "mix" ? mix : vibes[vibe];
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

/** Pairs every vibe (and base) must satisfy. `hairline` and `hand` are decorative and deliberately not checked. */
export const COMMON_PAIRS: readonly ContrastPair[] = [
  text("ink", "bg"),
  text("ink", "surface"),
  text("ink", "surface-2"),
  text("ink-muted", "bg"),
  text("ink-muted", "surface"),
  text("ink-muted", "surface-2"),
  text("ink", "field"),
  text("ink-muted", "field"),
  text("danger", "field"),
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
  bold: [
    ui("border", "surface"),
    ui("accent", "surface"),
    ui("focus-ring", "surface-2"),
    text("success", "surface"),
    text("warning", "surface"),
    text("link", "surface-2"),
  ],
};

export function pairsFor(vibe: Vibe | "base" | "mix"): ContrastPair[] {
  return [...COMMON_PAIRS, ...(vibe === "base" || vibe === "mix" ? [] : (EXTRA_PAIRS[vibe] ?? []))];
}
