/**
 * Image rendering for scripts/store-values/apply-catalogue.ts. Everything is drawn in memory with
 * sharp from the placeholder SVG art in public/placeholders/cutouts/; nothing is written to disk.
 *
 *   cutout  1600 x 1600 transparent PNG, art trimmed to its outline and centred (hero / cards)
 *   photo   1200 x 1200 JPEG (the storefront crops every product image to a square)
 *     photo 1: art centred on a soft tinted backdrop, soft drop shadow, light paper grain
 *     photo 2: art tilted slightly on a contrasting grid mat, with a ruler drawn to scale
 *   banner  640 x 640 PNG tile (the home banner shows it as a 128 px square, object-contain)
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import sharp, { type OverlayOptions } from "sharp";

export const CUTOUT_PX = 1600;
export const PHOTO_PX = 1200;
const ART_LONGEST_PX = 1440;
const SVG_DIR = path.join(process.cwd(), "public/placeholders/cutouts");

export interface ImageMeta {
  visual: string;
  bg1: [string, string];
  bg2: [string, string];
  /** Real-world length of the art's longest side in mm (drives the ruler scale). */
  sizeMm: number;
  /** Degrees; photo 2 only. */
  tilt: number;
}

export interface LoadedArt {
  /** Transparent PNG, trimmed to the outline, longest side ART_LONGEST_PX. */
  png: Buffer;
  width: number;
  height: number;
}

/** Renders an SVG from public/placeholders/cutouts and trims it to the outline. */
export async function loadArt(file: string): Promise<LoadedArt> {
  const svg = readFileSync(path.join(SVG_DIR, file));
  const big = await sharp(svg, { density: 72 * (3000 / 512) })
    .resize(3000, 3000)
    .png()
    .toBuffer();
  const trimmed = await sharp(big).trim({ threshold: 4 }).toBuffer();
  const png = await sharp(trimmed)
    .resize(ART_LONGEST_PX, ART_LONGEST_PX, { fit: "inside", kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const meta = await sharp(png).metadata();
  return { png, width: meta.width!, height: meta.height! };
}

/** Transparent square PNG with the art centred (passes the cutout alpha check, >= 1200 px). */
export async function renderCutout(art: LoadedArt): Promise<Buffer> {
  return sharp({
    create: {
      width: CUTOUT_PX,
      height: CUTOUT_PX,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: art.png, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ---------------------------------------------------------------------------------------------
// colour helpers
// ---------------------------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]: [number, number, number]): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function mix(hex: string, other: string, t: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ---------------------------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------------------------

/** Deterministic pseudo-random bytes so reruns render identical grain. */
function noiseBuffer(width: number, height: number, alpha: number, seed: number): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < width * height; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    const v = s & 255;
    buf[i * 4] = v;
    buf[i * 4 + 1] = v;
    buf[i * 4 + 2] = v;
    buf[i * 4 + 3] = alpha;
  }
  return buf;
}

async function grain(size: number, alpha: number, seed: number): Promise<Buffer> {
  return sharp(noiseBuffer(size, size, alpha, seed), {
    raw: { width: size, height: size, channels: 4 },
  })
    .blur(0.7)
    .png()
    .toBuffer();
}

function backdropSvg(
  size: number,
  bg: string,
  gridPxPerMm?: number,
  gridOrigin?: [number, number],
): string {
  const centre = mix(bg, "#ffffff", luminance(bg) > 0.5 ? 0.45 : 0.14);
  const edge = mix(bg, "#000000", luminance(bg) > 0.5 ? 0.05 : 0.2);
  const dark = luminance(bg) < 0.5;
  let grid = "";
  if (gridPxPerMm && gridOrigin) {
    const step = gridPxPerMm * 10;
    const lines: string[] = [];
    const lineColour = dark ? "#ffffff" : "#000000";
    for (let x = gridOrigin[0] % step; x <= size; x += step) {
      const major = Math.round((x - gridOrigin[0]) / step) % 5 === 0;
      lines.push(
        `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${size}" stroke="${lineColour}" stroke-opacity="${major ? 0.16 : 0.08}" stroke-width="${major ? 2.5 : 1.5}"/>`,
      );
    }
    for (let y = gridOrigin[1] % step; y <= size; y += step) {
      const major = Math.round((y - gridOrigin[1]) / step) % 5 === 0;
      lines.push(
        `<line x1="0" y1="${y.toFixed(1)}" x2="${size}" y2="${y.toFixed(1)}" stroke="${lineColour}" stroke-opacity="${major ? 0.16 : 0.08}" stroke-width="${major ? 2.5 : 1.5}"/>`,
      );
    }
    grid = lines.join("");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="${centre}"/><stop offset="1" stop-color="${edge}"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>${grid}</svg>`;
}

/** Soft shadow layers (same size as `art`, padded) for the art's alpha silhouette. */
async function shadowLayer(
  art: Buffer,
  blur: number,
  opacity: number,
  pad: number,
): Promise<{ input: Buffer; pad: number }> {
  const meta = await sharp(art).metadata();
  const w = meta.width!;
  const h = meta.height!;
  const alpha = await sharp(art).ensureAlpha().extractChannel("alpha").raw().toBuffer();
  const scaled = Buffer.from(alpha.map((v) => Math.round(v * opacity)));
  const black = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 8, g: 6, b: 16 } },
  })
    .joinChannel(scaled, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
  const padded = await sharp(black)
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .blur(blur)
    .png()
    .toBuffer();
  return { input: padded, pad };
}

interface Placed {
  png: Buffer;
  width: number;
  height: number;
  /** Scale applied to the trimmed, un-rotated art. */
  scale: number;
}

/** Rotates the art, then fits it inside `box` (never upscales beyond 1). */
async function placeArt(art: LoadedArt, box: [number, number], rotate: number): Promise<Placed> {
  const rotated = rotate
    ? await sharp(art.png)
        .rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    : art.png;
  const rm = await sharp(rotated).metadata();
  const scale = Math.min(box[0] / rm.width!, box[1] / rm.height!, 1);
  const w = Math.max(1, Math.round(rm.width! * scale));
  const h = Math.max(1, Math.round(rm.height! * scale));
  const png = await sharp(rotated).resize(w, h, { kernel: "lanczos3" }).png().toBuffer();
  return { png, width: w, height: h, scale };
}

async function compose(
  size: number,
  backdrop: string,
  grainSeed: number,
  placed: Placed,
  centre: [number, number],
  overlay?: Buffer,
): Promise<Buffer> {
  const left = Math.round(centre[0] - placed.width / 2);
  const top = Math.round(centre[1] - placed.height / 2);
  const soft = await shadowLayer(placed.png, 26, 0.3, 90);
  const contact = await shadowLayer(placed.png, 6, 0.38, 24);
  const layers: OverlayOptions[] = [
    { input: await grain(size, 14, grainSeed), left: 0, top: 0 },
    { input: soft.input, left: left - soft.pad + 6, top: top - soft.pad + 38 },
    { input: contact.input, left: left - contact.pad + 2, top: top - contact.pad + 11 },
    { input: placed.png, left, top },
  ];
  if (overlay) layers.push({ input: overlay, left: 0, top: 0 });
  return sharp(Buffer.from(backdrop))
    .composite(layers)
    .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

// ---------------------------------------------------------------------------------------------
// photos
// ---------------------------------------------------------------------------------------------

/** Photo 1: the art centred on a soft backdrop tinted for the product. */
export async function renderPhotoOne(art: LoadedArt, meta: ImageMeta): Promise<Buffer> {
  const placed = await placeArt(art, [800, 760], 0);
  return compose(PHOTO_PX, backdropSvg(PHOTO_PX, meta.bg1[0]), 11, placed, [PHOTO_PX / 2, 560]);
}

function rulerSvg(size: number, x0: number, y: number, lengthMm: number, pxPerMm: number): string {
  const w = lengthMm * pxPerMm;
  const h = 78;
  const ticks: string[] = [];
  const labels: string[] = [];
  const everyMm = pxPerMm >= 6 ? 1 : 5;
  for (let mm = 0; mm <= lengthMm; mm += everyMm) {
    const x = x0 + mm * pxPerMm;
    const len = mm % 10 === 0 ? 34 : mm % 5 === 0 ? 24 : 14;
    ticks.push(
      `<line x1="${x.toFixed(1)}" y1="${y}" x2="${x.toFixed(1)}" y2="${y + len}" stroke="#4a3a12" stroke-width="${mm % 10 === 0 ? 2.5 : 1.6}"/>`,
    );
    if (mm % 10 === 0) {
      labels.push(
        `<text x="${x.toFixed(1)}" y="${y + 62}" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="600" fill="#4a3a12" text-anchor="middle">${mm / 10}</text>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect x="${x0 - 14}" y="${y}" width="${(w + 28).toFixed(1)}" height="${h}" rx="8" fill="#F7E8B5" stroke="#00000033" stroke-width="2"/>
  <rect x="${x0 - 14}" y="${y}" width="${(w + 28).toFixed(1)}" height="${h}" rx="8" fill="#ffffff" fill-opacity="0.18"/>
  ${ticks.join("")}${labels.join("")}
  <text x="${x0 + 4}" y="${y + h - 8}" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#4a3a12" opacity="0.8">cm</text>
  </svg>`;
}

/** Photo 2: tilted art on a contrasting grid mat with a ruler to scale. */
export async function renderPhotoTwo(art: LoadedArt, meta: ImageMeta): Promise<Buffer> {
  const longestOriginal = Math.max(art.width, art.height);
  const placed = await placeArt(art, [720, 560], meta.tilt);
  const pxPerMm = (longestOriginal * placed.scale) / meta.sizeMm;
  const lengthMm = Math.max(20, Math.min(200, Math.floor(1000 / pxPerMm / 10) * 10));
  const rulerX = Math.round((PHOTO_PX - lengthMm * pxPerMm) / 2);
  const rulerY = 930;
  const origin: [number, number] = [rulerX, rulerY];
  const overlay = await sharp(Buffer.from(rulerSvg(PHOTO_PX, rulerX, rulerY, lengthMm, pxPerMm)))
    .png()
    .toBuffer();
  return compose(
    PHOTO_PX,
    backdropSvg(PHOTO_PX, meta.bg2[0], pxPerMm, origin),
    29,
    placed,
    [PHOTO_PX / 2, 470],
    overlay,
  );
}

// ---------------------------------------------------------------------------------------------
// banner tile
// ---------------------------------------------------------------------------------------------

export interface BannerPiece {
  art: LoadedArt;
  size: number;
  x: number;
  y: number;
  rotate: number;
}

const BANNER_PX = 640;

/** A rounded square tile (cream border, vibe colours) with several cutouts on it; transparent corners. */
export async function renderBannerTile(
  tile: { from: string; to: string },
  pieces: BannerPiece[],
): Promise<Buffer> {
  const r = 120;
  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${BANNER_PX}" height="${BANNER_PX}">
  <defs>
    <linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tile.from}"/><stop offset="1" stop-color="${tile.to}"/></linearGradient>
    <radialGradient id="h" cx="30%" cy="25%" r="70%"><stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="8" y="8" width="${BANNER_PX - 16}" height="${BANNER_PX - 16}" rx="${r}" fill="#FFF6E8"/>
  <rect x="30" y="30" width="${BANNER_PX - 60}" height="${BANNER_PX - 60}" rx="${r - 22}" fill="url(#t)"/>
  <rect x="30" y="30" width="${BANNER_PX - 60}" height="${BANNER_PX - 60}" rx="${r - 22}" fill="url(#h)"/></svg>`;
  const layers: OverlayOptions[] = [];
  const scale = BANNER_PX / 512;
  for (const p of pieces) {
    const placed = await placeArt(p.art, [p.size * scale, p.size * scale], p.rotate);
    const left = Math.round(p.x * scale - placed.width / 2);
    const top = Math.round(p.y * scale - placed.height / 2);
    const soft = await shadowLayer(placed.png, 10, 0.32, 40);
    layers.push({ input: soft.input, left: left - soft.pad + 4, top: top - soft.pad + 16 });
    layers.push({ input: placed.png, left, top });
  }
  const composed = await sharp(Buffer.from(base)).composite(layers).png().toBuffer();
  // Clip anything that spills past the rounded outer edge.
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BANNER_PX}" height="${BANNER_PX}"><rect x="8" y="8" width="${BANNER_PX - 16}" height="${BANNER_PX - 16}" rx="${r}" fill="#fff"/></svg>`,
  );
  return sharp(composed)
    .composite([{ input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
