# Catalogue backend (Phase 3, server side)

Server-only data layer for the storefront catalogue, search, inventory, content and media. No pages live here; pages consume the cached wrappers in `src/server/cache/`.

## Layering

| Layer | Where | Rule |
|---|---|---|
| Query functions | `src/server/services/{catalog,search,content,inventory}.ts`, helpers in `services/queries/` | Plain functions taking a Drizzle handle (`db`, or `tx`). No Next imports. Tested in Vitest against `ifonli_test`. |
| Cached wrappers | `src/server/cache/{catalog,content}.ts` | Thin `'use cache'` + `cacheTag` + `cacheLife` functions with the same names as the queries, minus the `db` argument. Never imported by tests. |
| Tags and invalidation | `src/server/cache/tags.ts` (pure), `src/server/cache/revalidate.ts` (Next) | Tag helpers are unit-tested; `revalidate.ts` calls `updateTag` / `revalidateTag`. |
| Storage / media | `src/server/storage/index.ts`, `services/media.ts` | Supabase Storage REST via `fetch` and the service-role key (no supabase-js). |

Storefront visibility everywhere: product `status = 'active'` AND its type `active` AND at least one active variant. Drafts, archived products, products of a deactivated type and products with no active variant are invisible (cards, PDP, search, sitemap, featured sets).

## Services

- `catalog.ts`: `listProducts(db, params)`, `getProductBySlug(db, slug)`, `getLiveAvailability(db, productId)`, `getCollections(db)`, `getFeaturedForAllVibes(db, limitPerVibe = 8)`, `getHeroTilesForAllVibes(db, limit = 14)`, `getRelatedProducts(db, productId, limit = 8)`, `getAllProductSlugsForSitemap(db)`.
- `search.ts`: `searchProducts(db, { q, ...listParams, sort?: ... | "relevance", fallbackVibe? })`, `quickSearch(db, q, limit = 6)`, `sanitizeSearchQuery`.
- `inventory.ts`: `getVariantAvailability(variantIds, tx?, { now?, lock? })`, `adjustStock(input, tx?)`, `listLowStock(tx?)`, `ledgerFor(variantId, { limit, offset }, tx?)`, typed errors `InsufficientStockError`, `VariantNotFoundError`, `InvalidStockAdjustmentError`.
- `content.ts`: `getActiveBanners(db, { placement, vibe?, now })`, `getFaqs(db)`, `getPolicy(db, slug)`, `listPublishedPolicies(db)`.
- `media.ts`: `resolveImageUrl(path)`, `imageProps(image)`.

Pages call the cached wrapper (`@/server/cache/catalog`), except live stock which is uncached: `getLiveAvailability(getDb(), product.id)` inside a Suspense hole.

### Listing semantics

The catalogue index (all visible products with card data) is loaded in a handful of queries and filtered, faceted, sorted and paged in memory (`queries/listing.ts`). That is deliberate: availability uses the domain `availableQty` (active, unexpired reservations; expiry evaluated at read time), and facets are cheap. It is sized for hundreds to low thousands of products and sits behind `'use cache'`. If the catalogue outgrows that, move filtering into SQL.

- `ProductCard`: id, slug, name, typeSlug/typeName, vibeSlugs, primaryVibe, priceFromPaise (cheapest active variant), mrpFromPaise (that variant's MRP), hasMultipleVariants, inStock, lowStock, `image` (first photo, else first cutout), `cutout`.
- `primaryVibe`: lowest `featured_rank` across the product's vibes (NULL last), then vibe `sort`, then slug. The seed ranks a product only in its main vibe so this is deterministic.
- `inStock`: any active variant with available > 0. `lowStock`: in stock and every active variant is at or below its threshold (variant override, else `default_low_stock_threshold`).
- Sorts: `featured` = `featured_rank` within `featuredForVibe` (or the single filtered vibe), unranked last, then newest; with no vibe context it is newest first. `newest` = `created_at` desc then slug. `price_asc` / `price_desc` use `priceFromPaise`. Price filters also use `priceFromPaise`.
- Facets are disjunctive: each is counted over products matching every filter except its own. Selected values with no matches stay with count 0. `priceRange` ignores the price filter. Page size defaults to 24, max 60.
- Featured sets: curated `featured_slots` (by rank) when the vibe has any visible curated product, otherwise the newest products of the vibe. Curated sets are not topped up.
- Hero tiles: curated `hero_tiles` slots that have a cutout, else products of the vibe with a cutout (vibe featured rank, then newest).
- PDP model (`getProductBySlug`): no stock, HSN or GST rate. `legal.manufacturer` = product `manufacturer_override` (validated), else the `default_manufacturer` setting; `legal.countryOfOrigin` = product value, else `default_country_of_origin`. `*IsPlaceholder` flags say when a value is still a settings placeholder so the UI can avoid showing it.

### Search

One SQL step finds matching ids, then the same in-memory pipeline filters, facets, sorts and pages them.

1. Full text (tier 2): per product document = `products.search_tsv` (name A, description C) concatenated with the type name and vibe names (weight B), matched with `websearch_to_tsquery('english', immutable_unaccent(q))`, ranked with `ts_rank` (+1 for an exact name). So `gothic`, `sticker`, `stickers` and `gothic charm` work through type/vibe names. This is a scan over active products (fine at this scale).
2. SKU prefix (tier 3), for queries without spaces and at least 3 characters.
3. Trigram fallback (tier 1) only when fewer than 3 hits so far. With zero hits it is lenient (`similarity(name, q) > 0.25` or `word_similarity` over name + type + vibes at 0.5, stricter for 3-4 character queries). With some hits it only adds near-matches (>= 0.7), so a correct narrow query is not padded. This gives `skul` -> Skull charm and `stiker` -> stickers.
4. Order: tier desc, score desc, name. `sort: "featured"` behaves as relevance in search.

Input is sanitised (NFKC, control characters to spaces, whitespace collapsed, 100 character cap) and is always a bound parameter. Empty or junk queries return no items plus `suggestions` (popular products in `fallbackVibe`, else newest in-stock). Search is not cached (the page is dynamic by `searchParams`). Postgres may emit a "query contains only stop words" NOTICE for queries like `the`; it is harmless.

## Caching

Tags (constants and helpers in `src/server/cache/tags.ts`):

| Tag | Meaning |
|---|---|
| `product:{id}` | one product's PDP model |
| `product-slug:{slug}` | PDP by slug (include the old slug on rename) |
| `collection:vibe:{slug}`, `collection:type:{slug}` | everything shown for that collection (lists, PDPs in it, its copy) |
| `catalog` | any product change (lists, home sets, related, sitemap) |
| `content` | banners, featured sets, hero tiles, FAQs, policies |
| `settings` | settings leaking into cached output (PDP manufacturer / country) |
| `stock:{productId}` | stock flags of a product inside cached cards |
| `stock` | global; lists that filter by stock (`inStockOnly`), or results above 80 products |

Tags are added after the data is fetched where they depend on it (the PDP adds `product:{id}` plus its vibe/type tags once loaded). `cacheLife`: `hours` for catalogue entries (tag-invalidated), `minutes` for banners (they are schedule-dependent), `days` for FAQs and policies.

Cache keys include arguments, so pages must normalise URL params (known slugs, bounded page size) before calling a wrapper.

### Invalidation: `updateTag` vs `revalidateTag`

`src/server/cache/revalidate.ts` exports `revalidateCatalog({ productIds, productSlugs, vibeSlugs, typeSlugs })`, `revalidateStock({ productIds })`, `revalidateContent()`, `revalidateSettings()`.

- Default (`via: "action"`) uses `updateTag`: Server Actions only, expires immediately, the next request waits for fresh data (read-your-own-writes). Admin edits run in Server Actions and the owner expects the storefront to show the change straight away.
- `via: "route"` uses `revalidateTag(tag, "max")` (stale-while-revalidate), which also works in Route Handlers. Use it from webhooks and cron (for example the Razorpay webhook decrementing stock). The single-argument form of `revalidateTag` is deprecated in Next 16.
- A product-level change (ids or slugs given) also expires `catalog`; a vibe/type-only change (editing collection copy) expires only that collection tag.

## Inventory

Every stock change writes an `inventory_movements` row and updates `stock_on_hand` in one transaction. `adjustStock` uses a guarded `UPDATE ... WHERE stock_on_hand + delta >= 0`, so concurrent decrements serialise on the row lock and the loser gets `InsufficientStockError` (the DB CHECK is the backstop). It guards on-hand stock only; callers that must respect live reservations check `getVariantAvailability` first. Reservation create/convert/release belongs to the checkout phase. After a stock change call `revalidateStock`.

## Storage and media

Buckets: `products`, `cutouts`, `content` (public), `private` (support photos, invoices). `pnpm storage:setup` creates or reconciles them (size limit 10 MB, image MIME allow-list; SVG is not allowed in storage). Helpers: `ensureBuckets()`, `createSignedUploadUrl(bucket, path)`, `createSignedReadUrl(bucket, path, expiresIn)`, `publicUrl(bucket, path)`.

Image `path` convention in `product_images.path`: starts with `/` = site-relative file in `public/` (placeholders); otherwise `bucket/object-path` in a public bucket. `resolveImageUrl` rejects private/unknown buckets and traversal.

`next.config.ts` needs the storage host in `images.remotePatterns` (local Supabase shown; add the production Supabase host too):

```ts
images: {
  remotePatterns: [
    {
      protocol: "http",
      hostname: "127.0.0.1",
      port: "54321",
      pathname: "/storage/v1/object/public/**",
    },
    // production: { protocol: "https", hostname: "<project-ref>.supabase.co", pathname: "/storage/v1/object/public/**" },
  ],
},
```

On Next 16, local-IP image sources are blocked unless `images.dangerouslyAllowLocalIP: true` is set (dev only).

## Dev product seed (PLACEHOLDER DATA)

`pnpm db:seed-products` (run `pnpm db:seed` first). Idempotent: products upsert by slug, variants by SKU, images and featured slots refresh in place; opening stock (and its `restock` ledger row) is written only when a variant is first created. Refuses to run with `NODE_ENV=production` unless `--force-placeholder`.

It creates one product per placeholder cutout (32: 10 charms, 6 hippers, 10 3D stickers, 6 DIY), 43 variants, 64 images (cutout used as both photo and cutout) and 80 `featured_slots` rows (first 8 per vibe for each of `home_featured` and `hero_tiles`). `featured_rank` is set only on a product's first listed vibe. Eight products have options with swatches or "Pack of 1 / Pack of 3": Heart charm, Star charm, Skull charm, Bow hair clip, Daisy pin, Puffy cat face sticker, Bead strand, Phone strap kit. Two products are sold out (Lightning bolt charm, Candle sticker) and three variants are low stock (WOW sticker, Chain links, Pink heart charm).

The schema has no placeholder flag on products or variants, so seeded data is identified by:

- variant SKUs starting with `PH-`;
- `product_images.is_placeholder = true` (launch blocks while any remain);
- `country_of_origin = 'India'` (an assumption), `hsn_code` NULL, `gst_rate_bp` NULL (store default).

Everything below is placeholder and must be replaced or confirmed by the owner before launch: all product names, descriptions and SEO text (neutral copy, no material claims), all prices and MRPs (charms 149-399, hippers 199-349, stickers 99-249, DIY 399-999 rupees; about 30% have MRP above price), stock quantities, net quantity, weights, country of origin, and the artwork. The seed prints a warning to this effect on every run.

To list seeded rows: `select p.slug from products p join variants v on v.product_id = p.id where v.sku like 'PH-%' group by p.slug;`.
