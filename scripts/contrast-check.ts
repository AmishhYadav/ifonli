/**
 * Token contrast gate (plan section 13): every declared fg/bg pair in every vibe (and base) must meet
 * WCAG AA (4.5:1 text, 3:1 UI). Also fails when generated token CSS is stale.
 * Run: pnpm contrast
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { VIBES } from "../src/features/vibe/config";
import { contrastRatio } from "../src/features/vibe/contrast";
import { generateTokenCss } from "../src/features/vibe/tokens-css";
import { pairsFor, resolveTokens } from "../src/features/vibe/tokens";

const ROOT = path.resolve(__dirname, "..");
let failures = 0;
let total = 0;

for (const vibe of ["base", ...VIBES] as const) {
  const { palette } = resolveTokens(vibe);
  console.log(`\n${vibe}`);
  console.log("  pair                        min    ratio  result");
  for (const pair of pairsFor(vibe)) {
    total += 1;
    const fg = palette[pair.fg];
    const bg = palette[pair.bg];
    let ratio: number;
    try {
      ratio = contrastRatio(fg, bg);
    } catch (error) {
      failures += 1;
      console.log(`  ${pair.label.padEnd(26)}  ERROR  ${(error as Error).message}`);
      continue;
    }
    const ok = ratio >= pair.min;
    if (!ok) failures += 1;
    console.log(
      `  ${pair.label.padEnd(26)}  ${String(pair.min).padEnd(5)}  ${ratio.toFixed(2).padStart(5)}  ${ok ? "ok" : "FAIL"}`,
    );
  }
}

// Generated CSS must match tokens.ts.
const dir = path.join(ROOT, "src/styles/tokens");
for (const [file, css] of Object.entries(generateTokenCss())) {
  const target = path.join(dir, file);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current !== css) {
    failures += 1;
    console.log(`\nSTALE: src/styles/tokens/${file} (run: pnpm exec tsx scripts/build-tokens.ts)`);
  }
}

if (failures > 0) {
  console.error(`\ncontrast-check: ${failures} failure(s) out of ${total} pairs`);
  process.exit(1);
}
console.log(`\ncontrast-check: all ${total} pairs pass; token CSS is up to date`);
