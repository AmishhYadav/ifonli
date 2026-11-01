/**
 * Vibe configuration: the single source of truth for vibe ids, order, names, fonts and asset paths.
 * No DOM access and no colour values here, so it is safe to import from server and client code.
 */

export const VIBES = ["cute", "funky", "bold", "gothic"] as const;
export type Vibe = (typeof VIBES)[number];

/** Fixed cycle order of the hand button (differs from the nav/listing order in VIBES). Fed by `settings.vibe_cycle`. */
export const DEFAULT_VIBE_CYCLE: readonly Vibe[] = ["cute", "gothic", "funky", "bold"];
export const DEFAULT_VIBE: Vibe = "cute";

/** `"random"` picks a vibe client-side when nothing is stored (settings.default_vibe may be "random"). */
export type DefaultVibeSetting = Vibe | "random";

export const VIBE_COOKIE = "ifonli_vibe";
export const VIBE_STORAGE_KEY = "ifonli_vibe";
export const VIBE_URL_PARAM = "vibe";
export const VIBE_CHANGE_EVENT = "ifonli:vibe-change";
export const VIBE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const VIBE_NAMES: Record<Vibe, string> = {
  cute: "Mochi",
  funky: "Chaos Cabinet",
  bold: "Unapologetic",
  gothic: "After the Dark",
};

export const BODY_FONT_FILE = "/fonts/nunito-wght400-800-latin.woff2";

/** Display font file per vibe (served from /public/fonts). */
export const DISPLAY_FONT_FILES: Record<Vibe, string> = {
  cute: "/fonts/fredoka-wght500-700-latin.woff2",
  funky: "/fonts/rubik-glitch-wght400-latin.woff2",
  bold: "/fonts/bebas-neue-wght400-latin.woff2",
  gothic: "/fonts/creepster-wght400-latin.woff2",
};

/** `document.fonts.load()` descriptors, matching the @font-face rules in styles/fonts.css. */
export const DISPLAY_FONT_LOAD: Record<Vibe, string> = {
  cute: '600 1em "Fredoka"',
  funky: '400 1em "Rubik Glitch"',
  bold: '400 1em "Bebas Neue"',
  gothic: '400 1em "Creepster"',
};

export const handUrl = (vibe: Vibe): string => `/vibe/hands/${vibe}.svg`;
export const textureUrl = (vibe: Vibe): string => `/vibe/textures/${vibe}.svg`;

export function isVibe(value: unknown): value is Vibe {
  return typeof value === "string" && (VIBES as readonly string[]).includes(value);
}

/** Next vibe in the cycle (wraps). An unknown/absent current vibe starts the cycle at its first entry. */
export function nextVibe(current: Vibe, cycle: readonly Vibe[] = DEFAULT_VIBE_CYCLE): Vibe {
  const first = cycle[0] ?? DEFAULT_VIBE;
  const index = cycle.indexOf(current);
  if (index === -1) return first;
  return cycle[(index + 1) % cycle.length] ?? first;
}
