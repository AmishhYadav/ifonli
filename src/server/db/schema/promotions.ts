import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { paise, pk, timestamps } from "./_common";
import { orders } from "./orders";

export const couponKindEnum = pgEnum("coupon_kind", ["percent", "fixed", "free_shipping"]);
export const redemptionStatusEnum = pgEnum("redemption_status", [
  "reserved",
  "confirmed",
  "released",
]);

export const coupons = pgTable(
  "coupons",
  {
    id: pk(),
    code: text("code").notNull(),
    kind: couponKindEnum("kind").notNull(),
    /**
     * Unit depends on `kind`: percent = basis points (1000 = 10%), fixed = paise,
     * free_shipping = 0.
     */
    value: paise("value").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    minSubtotalPaise: paise("min_subtotal_paise").notNull().default(0),
    maxDiscountPaise: paise("max_discount_paise"),
    usageLimit: integer("usage_limit"),
    perCustomerLimit: integer("per_customer_limit"),
    /** { vibes?: string[], types?: string[], products?: string[], excludeProducts?: string[] } */
    scope: jsonb("scope")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** v1: false (one coupon per order). */
    stackable: boolean("stackable").notNull().default(false),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    // Case-insensitive uniqueness without the citext extension: SAVE10 == save10.
    uniqueIndex("coupons_code_lower_uq").on(sql`lower(${t.code})`),
    check("coupons_code_nonblank", sql`length(btrim(${t.code})) > 0`),
    check(
      "coupons_value_by_kind",
      sql`(${t.kind} = 'percent' AND ${t.value} BETWEEN 1 AND 10000) OR (${t.kind} = 'fixed' AND ${t.value} > 0) OR (${t.kind} = 'free_shipping' AND ${t.value} = 0)`,
    ),
    check(
      "coupons_dates_ordered",
      sql`${t.startsAt} IS NULL OR ${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`,
    ),
    check("coupons_min_subtotal_nonneg", sql`${t.minSubtotalPaise} >= 0`),
    check(
      "coupons_max_discount_pos",
      sql`${t.maxDiscountPaise} IS NULL OR ${t.maxDiscountPaise} > 0`,
    ),
    check(
      "coupons_limits_pos",
      sql`(${t.usageLimit} IS NULL OR ${t.usageLimit} > 0) AND (${t.perCustomerLimit} IS NULL OR ${t.perCustomerLimit} > 0)`,
    ),
  ],
).enableRLS();

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: pk(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    status: redemptionStatusEnum("status").notNull().default("reserved"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("coupon_redemptions_coupon_order_uq").on(t.couponId, t.orderId),
    index("coupon_redemptions_coupon_status_idx").on(t.couponId, t.status),
    index("coupon_redemptions_coupon_email_idx").on(t.couponId, sql`lower(${t.email})`),
  ],
).enableRLS();
