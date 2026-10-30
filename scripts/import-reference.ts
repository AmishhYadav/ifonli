/**
 * Imports states + pincodes into the database.
 *
 *   pnpm db:import-reference [--dir <path>]     (default: data/reference)
 */
import path from "node:path";

import { config } from "dotenv";

config({ path: ".env.local" });
config();

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf("--dir");
  const dir = dirIdx >= 0 ? args[dirIdx + 1] : undefined;
  if (dirIdx >= 0 && !dir) {
    console.error("--dir requires a path");
    process.exit(2);
  }

  const { importReference, ReferenceFilesMissingError, DEFAULT_REFERENCE_DIR } =
    await import("../src/server/services/reference");
  const target = path.resolve(dir ?? DEFAULT_REFERENCE_DIR);
  console.log(`Importing reference data from ${target}`);
  try {
    const result = await importReference({ dir: target, log: (m) => console.log(`  ${m}`) });
    console.log(
      `Done: ${result.states} states, ${result.pincodes} pincodes upserted, ${result.skipped} rows skipped.`,
    );
    if (result.unknownStates.length > 0) {
      console.warn(`Unknown state names (rows skipped): ${result.unknownStates.join(", ")}`);
    }
  } catch (error) {
    if (error instanceof ReferenceFilesMissingError) {
      console.error(`\n${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
