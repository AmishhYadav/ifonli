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
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { paise, pk, timestamps, tsvector } from "./_common";

export const productStatusEnum = pgEnum("product_status", ["draft", "active", "archived"]);
export const imageKindEnum = pgEnum("image_kind", ["photo", "cutout"]);

/** The five moods ("vibes"): Cute, Bold, Overthinking, Gothic, Funky. */
export const vibes = pgTable("vibes", {
  id: pk(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  description: text("description"),
  seoTitle: text("seo_title"),
  seoDesc: text("seo_desc"),
  heroCopy: text("hero_copy"),
  ...timestamps(),
});

/** Charms, Hippers, 3D stickers, DIY accessories. Data, not code, so the owner can archive one. */
export const productTypes = pgTable("product_types", {
  id: pk(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  definition: text("definition"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  seoTitle: text("seo_title"),
  seoDesc: text("seo_desc"),
  ...timestamps(),
});

export const products = pgTable(
  "products",
  {
    id: pk(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    descriptionMd: text("description_md"),
    typeId: uuid("type_id")
      .notNull()
      .references(() => productTypes.id, { onDelete: "restrict" }),
    status: productStatusEnum("status").notNull().default("draft"),
    seoTitle: text("seo_title"),
    seoDesc: text("seo_desc"),
    // Legal Metrology / E-Commerce Rules / GST. NULL gst rate = use the store default setting.
    hsnCode: text("hsn_code"),
    gstRateBp: integer("gst_rate_bp"),
    countryOfOrigin: text("country_of_origin"),
    netQuantity: text("net_quantity"),
    dimensions: text("dimensions"),
    manufacturerOverride: jsonb("manufacturer_override"),
    isKit: boolean("is_kit").notNull().default(false),
    /**
     * Full-text vector: name (weight A) + description (weight C). Type and vibe names are folded in
     * by the search service at query time. `immutable_unaccent` is the IMMUTABLE wrapper created in
     * the 0000 custom migration (`unaccent()` itself is only STABLE).
     */
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', public.immutable_unaccent(coalesce(name, ''))), 'A') || setweight(to_tsvector('english', public.immutable_unaccent(coalesce(description_md, ''))), 'C')`,
    ),
    ...timestamps(),
  },
  (t) => [
    index("products_type_idx").on(t.typeId),
    index("products_status_idx").on(t.status),
    index("products_search_tsv_idx").using("gin", t.searchTsv),
    index("products_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
    check(
      "products_gst_rate_bp_range",
      sql`${t.gstRateBp} IS NULL OR ${t.gstRateBp} BETWEEN 0 AND 10000`,
    ),
  ],
);

export const productVibes = pgTable(
  "product_vibes",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    vibeId: uuid("vibe_id")
      .notNull()
      .references(() => vibes.id, { onDelete: "cascade" }),
    /** Lower = more prominent within the vibe's featured sets. NULL = not featured. */
    featuredRank: integer("featured_rank"),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.vibeId] }),
    index("product_vibes_vibe_rank_idx").on(t.vibeId, t.featuredRank),
  ],
);

export const productOptions = pgTable(
  "product_options",
  {
    id: pk(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("product_options_product_name_uq").on(t.productId, t.name)],
);

export const productOptionValues = pgTable(
  "product_option_values",
  {
    id: pk(),
    optionId: uuid("option_id")
      .notNull()
      .references(() => productOptions.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    swatchHex: text("swatch_hex"),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique("product_option_values_option_value_uq").on(t.optionId, t.value),
    check(
      "product_option_values_swatch_hex_fmt",
      sql`${t.swatchHex} IS NULL OR ${t.swatchHex} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
  ],
);

/** Every product has at least one variant; price and stock live here. */
export const variants = pgTable(
  "variants",
  {
    id: pk(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    title: text("title").notNull().default("Default"),
    optionValueIds: uuid("option_value_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    pricePaise: paise("price_paise").notNull(),
    /** Legal MRP (incl. all taxes). The spec's "compare-at" maps here. */
    mrpPaise: paise("mrp_paise").notNull(),
    stockOnHand: integer("stock_on_hand").notNull().default(0),
    /** NULL = use the `default_low_stock_threshold` setting. */
    lowStockThreshold: integer("low_stock_threshold"),
    weightG: integer("weight_g"),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index("variants_product_idx").on(t.productId, t.position),
    check("variants_stock_on_hand_nonneg", sql`${t.stockOnHand} >= 0`),
    check("variants_price_nonneg", sql`${t.pricePaise} >= 0`),
    check("variants_price_lte_mrp", sql`${t.pricePaise} <= ${t.mrpPaise}`),
    check(
      "variants_low_stock_nonneg",
      sql`${t.lowStockThreshold} IS NULL OR ${t.lowStockThreshold} >= 0`,
    ),
    check("variants_weight_nonneg", sql`${t.weightG} IS NULL OR ${t.weightG} >= 0`),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: pk(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    kind: imageKindEnum("kind").notNull().default("photo"),
    /** Storage object path (Supabase Storage bucket-relative). */
    path: text("path").notNull(),
    alt: text("alt").notNull(),
    width: integer("width"),
    height: integer("height"),
    position: integer("position").notNull().default(0),
    /** Generated placeholder art; launch is blocked while any remain. */
    isPlaceholder: boolean("is_placeholder").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("product_images_product_idx").on(t.productId, t.kind, t.position),
    index("product_images_variant_idx").on(t.variantId),
    check("product_images_alt_required", sql`length(btrim(${t.alt})) > 0`),
  ],
);

/** Schema only in v1 (fixed kits are plain products/variants with their own stock). */
export const bundleComponents = pgTable(
  "bundle_components",
  {
    id: pk(),
    kitVariantId: uuid("kit_variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    componentVariantId: uuid("component_variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "restrict" }),
    qty: integer("qty").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("bundle_components_kit_component_uq").on(t.kitVariantId, t.componentVariantId),
    index("bundle_components_component_idx").on(t.componentVariantId),
    check("bundle_components_qty_pos", sql`${t.qty} > 0`),
    check("bundle_components_not_self", sql`${t.kitVariantId} <> ${t.componentVariantId}`),
  ],
);
