import { sql } from "drizzle-orm";
import { bigint, customType, timestamp, uuid } from "drizzle-orm/pg-core";

/** uuid primary key with a database-side random default. */
export const pk = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** `updated_at` is bumped by Drizzle on every UPDATE issued through the ORM. */
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

/** Money column in integer paise. `mode: "number"` is safe up to 2^53 paise (~9e13 INR). */
export const paise = (name: string) => bigint(name, { mode: "number" });

/** Postgres tsvector (used for the generated `products.search_tsv`). */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export { sql };
