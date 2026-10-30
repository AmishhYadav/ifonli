import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, pk, timestamps } from "./_common";
import { user } from "./auth";
import { orders } from "./orders";

export const contactStatusEnum = pgEnum("contact_status", ["new", "open", "closed"]);
export const supportTypeEnum = pgEnum("support_type", [
  "damaged",
  "defective",
  "wrong",
  "missing",
  "other",
]);
export const supportStatusEnum = pgEnum("support_status", [
  "open",
  "in_progress",
  "resolved",
  "rejected",
]);
export const supportResolutionEnum = pgEnum("support_resolution", [
  "refund",
  "replacement",
  "rejected",
]);
export const notificationChannelEnum = pgEnum("notification_channel", ["email", "whatsapp"]);
export const notificationStatusEnum = pgEnum("notification_status", ["pending", "sent", "failed"]);

/**
 * Business-rule settings (plan section 14). Key is the primary key (natural id).
 * `is_placeholder` is true until an owner/admin explicitly sets the value.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  isPlaceholder: boolean("is_placeholder").notNull().default(true),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  ...timestamps(),
});

export const contactMessages = pgTable(
  "contact_messages",
  {
    id: pk(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    orderRef: text("order_ref"),
    message: text("message").notNull(),
    status: contactStatusEnum("status").notNull().default("new"),
    assignedTo: text("assigned_to").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("contact_messages_status_idx").on(t.status, t.createdAt)],
);

export const supportCases = pgTable(
  "support_cases",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: supportTypeEnum("type").notNull(),
    description: text("description").notNull(),
    /** Paths in the private storage bucket. */
    photoPaths: text("photo_paths")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: supportStatusEnum("status").notNull().default("open"),
    resolution: supportResolutionEnum("resolution"),
    notes: text("notes"),
    assignedTo: text("assigned_to").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("support_cases_order_idx").on(t.orderId),
    index("support_cases_status_idx").on(t.status, t.createdAt),
  ],
);

/** Transactional outbox: rows are written in the same transaction as the state change. */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: pk(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    channel: notificationChannelEnum("channel").notNull(),
    template: text("template").notNull(),
    to: text("to").notNull(),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: notificationStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerId: text("provider_id"),
    lastError: text("last_error"),
    ...timestamps(),
  },
  (t) => [
    index("notification_outbox_due_idx").on(t.status, t.nextAttemptAt),
    index("notification_outbox_order_idx").on(t.orderId),
    check("notification_outbox_attempts_nonneg", sql`${t.attempts} >= 0`),
  ],
);

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: pk(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    diff: jsonb("diff"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("admin_audit_log_entity_idx").on(t.entity, t.entityId),
    index("admin_audit_log_actor_idx").on(t.actorId, t.createdAt),
    index("admin_audit_log_created_idx").on(t.createdAt),
  ],
);

/** Fixed-window Postgres rate limiter (OTP, coupon, track lookup, contact, checkout). */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index("rate_limits_window_idx").on(t.windowStart),
  ],
);
