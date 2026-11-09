import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, pk, timestamps } from "./_common";
import { user } from "./auth";
import { products, vibes } from "./catalog";

export const bannerPlacementEnum = pgEnum("banner_placement", ["home_offer", "announcement"]);
export const featuredPlacementEnum = pgEnum("featured_placement", ["home_featured", "hero_tiles"]);
export const faqCategoryEnum = pgEnum("faq_category", ["delivery", "payment", "product", "orders"]);

export const banners = pgTable(
  "banners",
  {
    id: pk(),
    /** NULL = shown in every vibe. */
    vibeId: uuid("vibe_id").references(() => vibes.id, { onDelete: "cascade" }),
    placement: bannerPlacementEnum("placement").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    imagePath: text("image_path"),
    link: text("link"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("banners_placement_active_idx").on(t.placement, t.active, t.position),
    index("banners_vibe_idx").on(t.vibeId),
    check(
      "banners_dates_ordered",
      sql`${t.startsAt} IS NULL OR ${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`,
    ),
  ],
).enableRLS();

export const featuredSlots = pgTable(
  "featured_slots",
  {
    id: pk(),
    vibeId: uuid("vibe_id")
      .notNull()
      .references(() => vibes.id, { onDelete: "cascade" }),
    placement: featuredPlacementEnum("placement").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique("featured_slots_vibe_placement_product_uq").on(t.vibeId, t.placement, t.productId),
    index("featured_slots_vibe_placement_rank_idx").on(t.vibeId, t.placement, t.rank),
    index("featured_slots_product_idx").on(t.productId),
  ],
).enableRLS();

export const faqs = pgTable(
  "faqs",
  {
    id: pk(),
    category: faqCategoryEnum("category").notNull(),
    question: text("question").notNull(),
    answerMd: text("answer_md").notNull(),
    position: integer("position").notNull().default(0),
    published: boolean("published").notNull().default(true),
    ...timestamps(),
  },
  (t) => [index("faqs_category_position_idx").on(t.category, t.position)],
).enableRLS();

export const policies = pgTable("policies", {
  id: pk(),
  /** shipping | cancellation | returns-refunds | privacy | terms | seller-information */
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull().default(""),
  version: integer("version").notNull().default(1),
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  published: boolean("published").notNull().default(false),
  ...timestamps(),
}).enableRLS();

/** Immutable history; a row is written whenever a policy version is published. */
export const policyVersions = pgTable(
  "policy_versions",
  {
    id: pk(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [unique("policy_versions_policy_version_uq").on(t.policyId, t.version)],
).enableRLS();
