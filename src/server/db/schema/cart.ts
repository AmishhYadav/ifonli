import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { pk, timestamps } from "./_common";
import { user } from "./auth";
import { variants } from "./catalog";

export const carts = pgTable(
  "carts",
  {
    id: pk(),
    /** Opaque value of the httpOnly `cart_token` cookie. */
    token: text("token").notNull().unique(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    couponCode: text("coupon_code"),
    /** Bumped on every mutation; part of the checkout idempotency key. */
    version: integer("version").notNull().default(1),
    /** Housekeeping: stale guest carts are deleted after this. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("carts_user_idx").on(t.userId), index("carts_expires_idx").on(t.expiresAt)],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: pk(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("cart_items_cart_variant_uq").on(t.cartId, t.variantId),
    index("cart_items_variant_idx").on(t.variantId),
    check("cart_items_qty_pos", sql`${t.qty} > 0`),
  ],
);
