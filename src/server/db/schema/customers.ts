import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, pk, timestamps } from "./_common";
import { user } from "./auth";
import { products } from "./catalog";

export const customerProfiles = pgTable("customer_profiles", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  phone: text("phone"),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  /** DPDP: soft-delete marker while retention obligations run. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps(),
});

export const addresses = pgTable(
  "addresses",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    landmark: text("landmark"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    pincode: char("pincode", { length: 6 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("addresses_user_idx").on(t.userId),
    // At most one default address per user.
    uniqueIndex("addresses_one_default_per_user_uq")
      .on(t.userId)
      .where(sql`${t.isDefault}`),
  ],
);

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.productId] }),
    index("wishlist_items_product_idx").on(t.productId),
  ],
);
