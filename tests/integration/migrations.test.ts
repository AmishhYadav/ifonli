import { afterAll, describe, expect, it } from "vitest";

import { createSql } from "./helpers/db";
import { makeProduct } from "./helpers/factories";

const sql = createSql();
afterAll(() => sql.end());

const EXPECTED_TABLES = [
  "account",
  "addresses",
  "admin_audit_log",
  "analytics_events",
  "banners",
  "bundle_components",
  "cart_items",
  "carts",
  "contact_messages",
  "coupon_redemptions",
  "coupons",
  "customer_profiles",
  "faqs",
  "featured_slots",
  "inventory_movements",
  "invoice_counters",
  "invoices",
  "notification_outbox",
  "order_events",
  "order_items",
  "orders",
  "payments",
  "pincodes",
  "policies",
  "policy_versions",
  "product_engagement_daily",
  "product_images",
  "product_option_values",
  "product_options",
  "product_types",
  "product_vibes",
  "products",
  "rate_limits",
  "refunds",
  "session",
  "settings",
  "shipments",
  "states",
  "stock_reservations",
  "support_cases",
  "two_factor",
  "user",
  "variants",
  "verification",
  "vibes",
  "webhook_events",
  "wishlist_items",
];

describe("migrations", () => {
  it("applied cleanly to an empty database and created every table", async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual([...EXPECTED_TABLES].sort());
  });

  it("installs pg_trgm and unaccent plus the immutable wrapper", async () => {
    const ext = await sql<{ extname: string }[]>`SELECT extname FROM pg_extension`;
    expect(ext.map((e) => e.extname)).toEqual(expect.arrayContaining(["pg_trgm", "unaccent"]));
    const [r] = await sql<{ v: string }[]>`SELECT public.immutable_unaccent('Café Crème') AS v`;
    expect(r?.v).toBe("Cafe Creme");
  });

  it("populates the generated search_tsv and has GIN indexes for FTS and trigram", async () => {
    const product = await makeProduct({
      name: "Sparkle Star Charm",
      descriptionMd: "A shiny café keyring",
    });
    const [r] = await sql<
      { tsv: string }[]
    >`SELECT search_tsv::text AS tsv FROM products WHERE id = ${product.id}`;
    expect(r?.tsv).toContain("sparkl'");
    expect(r?.tsv).toContain("cafe"); // accent folded
    const match =
      await sql`SELECT 1 FROM products WHERE search_tsv @@ websearch_to_tsquery('english', 'charms') AND id = ${product.id}`;
    expect(match).toHaveLength(1);
    const idx = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'products'`;
    expect(idx.find((i) => i.indexname === "products_search_tsv_idx")?.indexdef).toMatch(
      /USING gin/,
    );
    expect(idx.find((i) => i.indexname === "products_name_trgm_idx")?.indexdef).toMatch(
      /gin_trgm_ops/,
    );
    const sim =
      await sql`SELECT 1 FROM products WHERE name % 'Sparkel Star Charm' AND id = ${product.id}`;
    expect(sim).toHaveLength(1);
  });
});
