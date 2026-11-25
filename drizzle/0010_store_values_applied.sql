-- Store values on deploy: one row per piece of content/ applied to this database (settings, catalogue, each policy),
-- with the hash of the files it was applied from. scripts/store-values-on-deploy.mjs re-applies a piece only when its
-- hash changes, so admin edits are not overwritten by every deploy. Not in the drizzle schema: only that script uses it.

CREATE TABLE IF NOT EXISTS "store_values_applied" (
  "key" text PRIMARY KEY,
  "hash" text NOT NULL,
  "applied_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "store_values_applied" ENABLE ROW LEVEL SECURITY;
