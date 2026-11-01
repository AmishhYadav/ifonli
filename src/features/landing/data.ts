import { VIBES, type Vibe } from "@/features/vibe/config";

/**
 * Landing page content that does not depend on settings: cutout art, the four product types and the
 * four moods. Pure data (no DOM, no colour values) so the server sections and the motion code agree.
 */

export const CUTOUT_BASE = "/placeholders/cutouts";
export const cutoutSrc = (name: string): string => `${CUTOUT_BASE}/${name}.svg`;

/** Positions are percentages of the opening; `m*` overrides apply on phones, `mobile: false` hides it there. */
export interface HeroCutout {
  name: string;
  x: string;
  y: string;
  size: string;
  rot: number;
  /** Parallax depth: bigger scatters further and faster when scrolling away. */
  depth: number;
  mobile?: { x: string; y: string; size: string };
  delay: number;
  dur: number;
}

export const HERO_CUTOUTS: readonly HeroCutout[] = [
  { name: "charm-heart", x: "6%", y: "20%", size: "clamp(5rem, 11vw, 10rem)", rot: -14, depth: 1.25, mobile: { x: "-2%", y: "17%", size: "5.2rem" }, delay: 350, dur: 7.4 },
  { name: "charm-star", x: "82%", y: "14%", size: "clamp(4.5rem, 8.5vw, 8rem)", rot: 16, depth: 0.7, mobile: { x: "76%", y: "13%", size: "4.4rem" }, delay: 470, dur: 6.2 },
  { name: "charm-mushroom", x: "13%", y: "66%", size: "clamp(4.75rem, 9.5vw, 9rem)", rot: 9, depth: 1.5, mobile: { x: "4%", y: "70%", size: "5rem" }, delay: 590, dur: 8.1 },
  { name: "charm-lightning", x: "85%", y: "62%", size: "clamp(4.5rem, 8.5vw, 8rem)", rot: -10, depth: 0.9, mobile: { x: "78%", y: "68%", size: "4.6rem" }, delay: 710, dur: 6.8 },
  { name: "hipper-rainbow-pin", x: "34%", y: "9%", size: "clamp(3.5rem, 6vw, 5.5rem)", rot: 12, depth: 0.5, delay: 830, dur: 7.9 },
  { name: "sticker3d-cat-face", x: "68%", y: "80%", size: "clamp(4rem, 7vw, 6.5rem)", rot: -8, depth: 1.1, delay: 950, dur: 7.1 },
  { name: "charm-evil-eye", x: "2%", y: "46%", size: "clamp(3.25rem, 5.5vw, 5rem)", rot: 6, depth: 0.8, delay: 1070, dur: 8.6 },
  { name: "charm-smiley", x: "90%", y: "40%", size: "clamp(3.5rem, 6vw, 5.5rem)", rot: -6, depth: 0.6, delay: 1190, dur: 6.6 },
];

export interface MakeItem {
  id: string;
  name: string;
  line: string;
  art: string;
  rot: number;
}

export const MAKES: readonly MakeItem[] = [
  { id: "charms", name: "Charms", line: "Dangle them from anything.", art: "charm-mushroom", rot: -9 },
  { id: "hippers", name: "Hippers", line: "Pins and clips with personality.", art: "hipper-bow-clip", rot: 8 },
  { id: "stickers", name: "3D Stickers", line: "Puffy, glossy, stick-on joy.", art: "sticker3d-cat-face", rot: -7 },
  { id: "diy", name: "DIY Accessories", line: "Kits to make it yours.", art: "diy-charm-bracelet-kit", rot: 10 },
];

export interface MoodCutout {
  name: string;
  /** Percent of the cutout box. */
  x: number;
  y: number;
  size: number;
  rot: number;
}

/** Three cutouts per mood, laid out in a 100 x 100 box. */
export const MOOD_CUTOUTS: Record<Vibe, readonly MoodCutout[]> = {
  cute: [
    { name: "charm-heart", x: 10, y: 22, size: 52, rot: -12 },
    { name: "charm-star", x: 56, y: 4, size: 38, rot: 14 },
    { name: "charm-mushroom", x: 50, y: 50, size: 44, rot: 8 },
  ],
  bold: [
    { name: "charm-lightning", x: 8, y: 20, size: 50, rot: -10 },
    { name: "sticker3d-wow", x: 52, y: 6, size: 44, rot: 9 },
    { name: "hipper-flame-pin", x: 48, y: 52, size: 42, rot: -6 },
  ],
  gothic: [
    { name: "charm-skull", x: 10, y: 22, size: 50, rot: -9 },
    { name: "charm-ghost", x: 54, y: 4, size: 40, rot: 8 },
    { name: "charm-moon", x: 50, y: 52, size: 42, rot: -12 },
  ],
  funky: [
    { name: "charm-smiley", x: 10, y: 22, size: 48, rot: -10 },
    { name: "hipper-rainbow-pin", x: 54, y: 4, size: 42, rot: 11 },
    { name: "sticker3d-groovy-flower", x: 48, y: 50, size: 46, rot: -6 },
  ],
};

/** Colour states of the fixed background. `site` = the visitor's own vibe, `accent` = the portal colour. */
export const BG_STATES = ["site", ...VIBES, "accent"] as const;
export type BgState = (typeof BG_STATES)[number];

/** Peek of the store inside the portal card: [name, left %, top %, size (vmin-ish rem), rot, inWindow]. */
export interface PortalCutout {
  name: string;
  x: number;
  y: number;
  size: string;
  rot: number;
  /** Visible in the small card; the rest are revealed as it opens. */
  peek: boolean;
}

export const PORTAL_CUTOUTS: readonly PortalCutout[] = [
  { name: "charm-heart", x: 36, y: 20, size: "clamp(3.5rem, 7vw, 6rem)", rot: -12, peek: true },
  { name: "hipper-flame-pin", x: 60, y: 18, size: "clamp(3.25rem, 6vw, 5.25rem)", rot: 10, peek: true },
  { name: "sticker3d-wow", x: 37, y: 74, size: "clamp(3.5rem, 6.5vw, 5.5rem)", rot: 8, peek: true },
  { name: "charm-star", x: 61, y: 76, size: "clamp(3.25rem, 6vw, 5rem)", rot: -14, peek: true },
  { name: "charm-ghost", x: 12, y: 18, size: "clamp(4rem, 8vw, 7rem)", rot: -8, peek: false },
  { name: "diy-keychain-ring", x: 80, y: 14, size: "clamp(4rem, 8vw, 7rem)", rot: 12, peek: false },
  { name: "charm-cherries", x: 9, y: 62, size: "clamp(4rem, 8vw, 7rem)", rot: 7, peek: false },
  { name: "sticker3d-strawberry", x: 84, y: 60, size: "clamp(4rem, 8vw, 7rem)", rot: -9, peek: false },
  { name: "hipper-daisy-pin", x: 22, y: 84, size: "clamp(3.5rem, 6vw, 5.5rem)", rot: 14, peek: false },
  { name: "sticker3d-cloud", x: 72, y: 86, size: "clamp(3.5rem, 6vw, 5.5rem)", rot: -6, peek: false },
];
