import { sql } from "drizzle-orm";
import { boolean, char, check, index, pgEnum, pgTable, text } from "drizzle-orm/pg-core";

import { timestamps } from "./_common";

export const stateTypeEnum = pgEnum("state_type", ["state", "ut"]);

/** Indian states and union territories keyed by 2-character GST state code ("27" = Maharashtra). */
export const states = pgTable("states", {
  code: char("code", { length: 2 }).primaryKey(),
  name: text("name").notNull().unique(),
  /** ISO 3166-2:IN code, e.g. "IN-MH". */
  iso: text("iso").notNull(),
  type: stateTypeEnum("type").notNull(),
  /** Shipping zone (see data/reference/zones.json). */
  zone: text("zone"),
  ...timestamps(),
});

/** India Post pincode directory (data.gov.in, GODL-India) plus serviceability/COD flags. */
export const pincodes = pgTable(
  "pincodes",
  {
    pincode: char("pincode", { length: 6 }).primaryKey(),
    district: text("district").notNull(),
    stateCode: char("state_code", { length: 2 })
      .notNull()
      .references(() => states.code, { onDelete: "restrict" }),
    zone: text("zone"),
    serviceable: boolean("serviceable").notNull().default(true),
    codAllowed: boolean("cod_allowed").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("pincodes_state_idx").on(t.stateCode),
    check("pincodes_format", sql`${t.pincode} ~ '^[0-9]{6}$'`),
  ],
);
