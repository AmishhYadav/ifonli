import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

/** One small shared connection for test fixtures (writes go straight to the dev database). */
export const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL || "", {
  max: 2,
  onnotice: () => {},
});

export function assertNotProduction(): void {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  if (!url) throw new Error("DATABASE_URL is not set");
  if (/supabase\.co|neon\.tech|amazonaws\.com|prod/i.test(url)) {
    throw new Error("Refusing to run test fixtures against what looks like a hosted database");
  }
}
