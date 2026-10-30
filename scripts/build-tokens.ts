/**
 * Generates src/styles/tokens/*.css from src/features/vibe/tokens.ts.
 *   pnpm exec tsx scripts/build-tokens.ts           write files
 *   pnpm exec tsx scripts/build-tokens.ts --check   exit 1 if any generated file is stale
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateTokenCss } from "../src/features/vibe/tokens-css";

const dir = path.resolve(__dirname, "../src/styles/tokens");
const check = process.argv.includes("--check");
const files = generateTokenCss();
let stale = 0;

if (!check) mkdirSync(dir, { recursive: true });

for (const [name, css] of Object.entries(files)) {
  const target = path.join(dir, name);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (check) {
    if (current !== css) {
      stale += 1;
      console.error(`stale: src/styles/tokens/${name}`);
    }
  } else if (current !== css) {
    writeFileSync(target, css);
    console.log(`wrote src/styles/tokens/${name}`);
  }
}

if (check) {
  if (stale > 0) {
    console.error(
      "build-tokens --check: generated CSS is out of date. Run: pnpm exec tsx scripts/build-tokens.ts",
    );
    process.exit(1);
  }
  console.log("build-tokens --check: up to date");
}
