import { sql } from "drizzle-orm";
import { check, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { paise, pk, timestamps } from "./_common";
import { user } from "./auth";
import { orders } from "./orders";

export const paymentRowStatusEnum = pgEnum("payment_row_status", [
  "created",
  "authorized",
  "captured",
  "failed",
]);
export const refundStatusEnum = pgEnum("refund_status", [
  "pending",
  "processed",
  "failed",
  "manual",
]);

export const payments = pgTable(
  "payments",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    provider: text("provider").notNull().default("razorpay"),
    providerOrderId: text("provider_order_id").notNull().unique(),
    /** NULL until the customer attempts payment. Postgres UNIQUE allows many NULLs. */
    providerPaymentId: text("provider_payment_id").unique(),
    amountPaise: paise("amount_paise").notNull(),
    status: paymentRowStatusEnum("status").notNull().default("created"),
    method: text("method"),
    raw: jsonb("raw"),
    ...timestamps(),
  },
  (t) => [
    index("payments_order_idx").on(t.orderId),
    check("payments_amount_pos", sql`${t.amountPaise} > 0`),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    /** NULL for manual (e.g. COD) refunds. */
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "restrict" }),
    providerRefundId: text("provider_refund_id").unique(),
    amountPaise: paise("amount_paise").notNull(),
    reason: text("reason"),
    status: refundStatusEnum("status").notNull().default("pending"),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    /** UPI / bank reference for manual refunds. */
    reference: text("reference"),
    ...timestamps(),
  },
  (t) => [
    index("refunds_order_idx").on(t.orderId),
    index("refunds_payment_idx").on(t.paymentId),
    check("refunds_amount_pos", sql`${t.amountPaise} > 0`),
  ],
);

/** Webhook idempotency ledger. `provider_event_id` is the x-razorpay-event-id header. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: pk(),
    provider: text("provider").notNull().default("razorpay"),
    providerEventId: text("provider_event_id").notNull().unique(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [index("webhook_events_type_idx").on(t.type, t.createdAt)],
);
