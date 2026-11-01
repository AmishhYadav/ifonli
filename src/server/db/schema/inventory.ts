import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, pk, timestamps } from "./_common";
import { user } from "./auth";
import { variants } from "./catalog";
import { orders } from "./orders";

export const movementReasonEnum = pgEnum("movement_reason", [
  "sale",
  "restock",
  "adjust",
  "cancel_restock",
  "return_restock",
  "correction",
]);
export const reservationStatusEnum = pgEnum("reservation_status", [
  "active",
  "converted",
  "released",
]);

/** Stock ledger: every change to `variants.stock_on_hand` is mirrored by a row here. Append-only. */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: pk(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "restrict" }),
    delta: integer("delta").notNull(),
    reason: movementReasonEnum("reason").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_movements_variant_created_idx").on(t.variantId, t.createdAt),
    index("inventory_movements_order_idx").on(t.orderId),
    check("inventory_movements_delta_nonzero", sql`${t.delta} <> 0`),
  ],
).enableRLS();

/**
 * Available = stock_on_hand - SUM(qty) of reservations with status = 'active' AND expires_at > now().
 * Expiry is evaluated at read time, so correctness never depends on the cleanup cron.
 */
export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "restrict" }),
    qty: integer("qty").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: reservationStatusEnum("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    index("stock_reservations_variant_status_expires_idx").on(t.variantId, t.status, t.expiresAt),
    /**
     * One reservation row per variant per order: `createFromCart` writes them once, one per cart line
     * (`cart_items` is unique per variant), and later only changes `status` in place. Also serves
     * lookups by order, so there is no separate order index.
     */
    uniqueIndex("stock_reservations_order_variant_uq").on(t.orderId, t.variantId),
    check("stock_reservations_qty_pos", sql`${t.qty} > 0`),
  ],
).enableRLS();
