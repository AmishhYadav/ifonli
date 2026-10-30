import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/*",
  out: "./drizzle",
  dbCredentials: {
    // Migrations use the direct (non-pooled) connection when available.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
  strict: true,
  verbose: true,
});
