-- DIY packs: every pack comes with one free chain, so fulfilment sees it as a real order line.
-- The chain is an ordinary product (price 0, its own SKU and stock) in a hidden "DIY parts" type. The type is switched
-- off (active = false), so the chain never appears in listings, search, navigation or on a product page; the cart still
-- accepts it, but only through the DIY pack action (services/cart.ts addDiyPack), once per pack.
-- Photo: /diy/chain.png (public/diy/): replace the file to change the picture everywhere.
-- Idempotent: every statement is a no-op once it has run. Stock starts at a working value of 500: adjust it in admin.

INSERT INTO "product_types" ("slug", "name", "definition", "sort", "active")
VALUES ('diy-parts', 'DIY parts', 'Parts that come with a DIY pack. Not sold on their own.', 90, false)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

INSERT INTO "products" ("slug", "name", "description_md", "type_id", "status", "hsn_code", "gst_rate_bp", "country_of_origin", "net_quantity")
SELECT 'diy-chain', 'DIY chain', 'The chain that comes free with every DIY pack. Hang your charms on it.', t."id", 'active'::product_status, '7117', 300, 'India', '1 piece'
FROM "product_types" t WHERE t."slug" = 'diy-parts'
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

WITH new_variant AS (
  INSERT INTO "variants" ("product_id", "sku", "title", "price_paise", "mrp_paise", "stock_on_hand", "weight_g")
  SELECT p."id", 'IFO-DIY-CHAIN', 'Default', 0, 0, 500, 5
  FROM "products" p WHERE p."slug" = 'diy-chain'
  ON CONFLICT ("sku") DO NOTHING
  RETURNING "id"
)
INSERT INTO "inventory_movements" ("variant_id", "delta", "reason", "note")
SELECT "id", 500, 'restock'::movement_reason, 'Initial stock' FROM new_variant;--> statement-breakpoint

INSERT INTO "product_images" ("product_id", "kind", "path", "alt", "width", "height", "position", "is_placeholder")
SELECT p."id", 'photo'::image_kind, '/diy/chain.png', 'A silver chain for your DIY pack', 512, 512, 0, false
FROM "products" p
WHERE p."slug" = 'diy-chain'
  AND NOT EXISTS (SELECT 1 FROM "product_images" i WHERE i."product_id" = p."id");
