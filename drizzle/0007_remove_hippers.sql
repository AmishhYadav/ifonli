-- Hippers is retired from the storefront. The product type is switched off rather than deleted: storefront visibility
-- needs the product AND its type to be active (catalog-index.ts), so the type disappears from navigation, listings,
-- search and the home page, while existing order lines (which point at these products) keep their history.
-- Idempotent: a no-op once it has run, and on an empty database.
UPDATE "product_types" SET "active" = false WHERE "slug" = 'hippers' AND "active" = true;
