/**
 * Renders the brand's static share and home-screen art once, so no request ever pays for it:
 *   pnpm brand:render
 *
 * Writes (all committed):
 *   src/app/opengraph-image.png   1200x630 share preview (Next file convention, served at /opengraph-image-<hash>.png)
 *   src/app/apple-icon.png        180x180 iOS home-screen icon
 *   src/app/favicon.ico           16/32/48 px, PNG-encoded entries
 *   public/icons/icon-192.png     web manifest icons (see src/app/manifest.ts)
 *   public/icons/icon-512.png
 *
 * Colours come from the vibe tokens (src/features/vibe/tokens.ts), the default mood (Mochi) for the icon and all four
 * moods for the share preview. The hand is the HandButton hand (src/features/vibe/HandButton.tsx, 90x90 viewBox).
 * The share preview is drawn by headless Chromium (the display fonts are woff2, which sharp's SVG renderer cannot
 * load); the icons are plain SVG rasterised with sharp.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";
import sharp from "sharp";

import {
  DEFAULT_VIBE,
  DISPLAY_FONT_FILES,
  VIBES,
  VIBE_NAMES,
  type Vibe,
} from "../../src/features/vibe/config";
import { ART_GRADIENTS, resolveTokens } from "../../src/features/vibe/tokens";

const root = path.resolve(__dirname, "../..");
const out = {
  og: path.join(root, "src/app/opengraph-image.png"),
  apple: path.join(root, "src/app/apple-icon.png"),
  favicon: path.join(root, "src/app/favicon.ico"),
  icon192: path.join(root, "public/icons/icon-192.png"),
  icon512: path.join(root, "public/icons/icon-512.png"),
};

const FINGERTIPS: readonly (readonly [number, number])[] = [
  [14, 46],
  [30, 18],
  [46, 10],
  [62, 16],
  [76, 32],
];

/** The hand, outlined in ink so it stays legible at 16 px: outlines first, then the skin on top (one union outline). */
function handSvg(skin: string, ink: string): string {
  const fingers = (stroke: string, width: number) =>
    FINGERTIPS.map(
      ([x, y], i) =>
        `<line x1="${32 + i * 7}" y1="56" x2="${x}" y2="${y}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`,
    ).join("");
  return [
    fingers(ink, 14),
    `<rect x="24" y="48" width="42" height="34" rx="14" fill="${ink}"/>`,
    fingers(skin, 9),
    `<rect x="26" y="50" width="38" height="30" rx="12" fill="${skin}"/>`,
  ].join("");
}

/** Square icon: Mochi gradient, hand centred inside the maskable safe zone (about 55% of the width). */
function iconSvg(size: number): string {
  const mochi = resolveTokens(DEFAULT_VIBE).palette;
  const [from, to] = ART_GRADIENTS[DEFAULT_VIBE];
  const scale = (size * 0.56) / 70; // the hand spans about 70 units of the 90 viewBox
  const offset = (size - 90 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <g transform="translate(${offset} ${offset + size * 0.02}) scale(${scale})">${handSvg(mochi.hand, mochi.ink)}</g>
</svg>`;
}

async function png(size: number): Promise<Buffer> {
  return sharp(Buffer.from(iconSvg(size)), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

/** A .ico whose entries are PNG images (supported by every browser since IE 11). */
function ico(images: readonly { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

function fontFace(family: string, file: string, weight: string): string {
  const data = readFileSync(path.join(root, "public", file)).toString("base64");
  return `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/woff2;base64,${data}) format("woff2");}`;
}

const MOOD_FONT: Record<Vibe, { family: string; weight: string }> = {
  cute: { family: "Fredoka", weight: "500 700" },
  funky: { family: "Rubik Glitch", weight: "400" },
  bold: { family: "Bungee Shade", weight: "400" },
  gothic: { family: "Creepster", weight: "400" },
};

function shareHtml(): string {
  const mochi = resolveTokens(DEFAULT_VIBE).palette;
  const [from, to] = ART_GRADIENTS[DEFAULT_VIBE];
  const fonts = [
    fontFace("Nunito", "fonts/nunito-wght400-800-latin.woff2", "400 800"),
    ...VIBES.map((v) => fontFace(MOOD_FONT[v].family, DISPLAY_FONT_FILES[v].replace(/^\//, ""), MOOD_FONT[v].weight)),
  ].join("\n");
  const pills = VIBES.map((v) => {
    const [a, b] = ART_GRADIENTS[v];
    const ink = resolveTokens(v).palette.ink;
    const { family, weight } = MOOD_FONT[v];
    return `<li style="background:linear-gradient(135deg,${a},${b});color:${ink};font-family:'${family}';font-weight:${weight}">${VIBE_NAMES[v]}</li>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fonts}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;font-family:Nunito,sans-serif;color:${mochi.ink};
  background:linear-gradient(135deg,${from},${to});position:relative}
.hand{position:absolute;right:96px;top:56px;width:380px;height:380px}
h1{position:absolute;left:84px;top:96px;font-family:Fredoka;font-weight:700;font-size:208px;line-height:1;letter-spacing:-2px}
p{position:absolute;left:92px;top:318px;font-size:46px;font-weight:800;line-height:1.2}
ul{position:absolute;left:84px;right:84px;bottom:64px;display:flex;gap:20px;list-style:none;padding:0}
li{flex:1;height:84px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-size:26px;white-space:nowrap;box-shadow:inset 0 0 0 2px color-mix(in srgb,${mochi.ink} 18%,transparent)}
</style></head><body>
<svg class="hand" viewBox="6 4 78 80">${handSvg(mochi.hand, mochi.ink)}</svg>
<h1>IfOnli</h1>
<p>Charms, 3D stickers<br>and DIY kits.</p>
<ul>${pills}</ul>
</body></html>`;
}

async function renderShare(): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.setContent(shareHtml());
    await page.evaluate(() => document.fonts.ready);
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(path.dirname(out.icon192), { recursive: true });
  writeFileSync(out.icon512, await png(512));
  writeFileSync(out.icon192, await png(192));
  writeFileSync(out.apple, await png(180));
  writeFileSync(
    out.favicon,
    ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size) })))),
  );
  writeFileSync(out.og, await sharp(await renderShare()).png({ compressionLevel: 9 }).toBuffer());
  console.log("brand art written: opengraph-image.png, apple-icon.png, favicon.ico, icons/icon-{192,512}.png");
}

void main();
