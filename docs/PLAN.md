# IfOnli — Implementation Plan

Source: `IfOnli — Website Master Specification.pdf` (17 pp, 30 Oct 2026). Repo `/Users/amish/IFONLI` currently holds only the spec — greenfield build.

## Context

IfOnli is an India-only (INR) D2C store for charms, Hippers, 3D stickers and DIY accessories, organised by **mood ("vibe")**. The spec asks for two things at once:

1. A **complete, serious store** — catalogue, search/filters, cart, checkout, Razorpay payments + COD, orders, stock, coupons, notifications, tracking, policies, admin, reports (FR-01…FR-27).
2. A **signature, design-heavy brand layer** — a hand button that re-skins the whole site across five vibe themes (Cute, Bold, Overthinking, Gothic, Funky) in under 400 ms, and a coded, animated product-tile hero.

Guiding principle from spec §9: *discovery is expressive, checkout is plain and clear.* This plan fixes the platform, settles every conflict the spec raises, turns all owner-only values ("Decide") into admin settings, and orders the build so that each phase ends in something deployable and testable.

---

## 1. Locked decisions

### Confirmed by owner (this session)

| # | Decision | Answer |
|---|---|---|
| 1 | Platform | **Custom Next.js 16 app** (storefront + checkout + admin in one codebase) on **Vercel**, **Supabase** Postgres and Storage |
| 2 | DIY bundles | **Fixed kits only**: a kit is a normal product or variant with its own stock. The schema keeps a `bundle_components` hook for a v2 builder |
| 3 | Payments | **Razorpay Standard Checkout** (UPI, cards, net banking, wallets) **plus an admin COD toggle** (pincode limits, max order value, optional fee) |
| 4 | Accounts | **Guest checkout on**, plus **optional passwordless email-OTP login** (order history, addresses, synced wishlist) |

### Resolved by this plan (reversible; logged in `docs/DECISIONS.md`)

| # | Decision | Resolution | Why |
|---|---|---|---|
| 12 | Several vibes per product? | **Yes.** Many-to-many `product_vibes`, with a `featured_rank` per vibe | Handles both answers; a single-vibe catalogue is just a special case |
| 11 | Variants | Every product has ≥1 variant (Shopify pattern). Options are generic name/value pairs (colour, size, pack count). **Stock and price live on the variant** | Handles any answer the owner gives later |
| 15 | Theme features vs hides | **Features, never hides** | FR-20's acceptance criterion already requires it |
| 13/14 | Cycle order / default / neutral theme | Admin settings `vibe_cycle` (ordered list) and `default_vibe` (a vibe or `random`). Placeholder: spec order Cute→Bold→Overthinking→Gothic→Funky, default Cute. The neutral "IfOnli" base exists as tokens but is **not in the cycle** | Not prices or policies, but still owner-tunable without code |
| 16 | Hand button on mobile | **Top-left on every breakpoint** (same spatial memory as desktop). Mobile header: `[hand] [logo] … [search] [cart] [☰]`, with the menu moved to the right | Honours the "Decided: top-left" rule |
| 17/18 | Hero build, length, clickability | **Coded (GSAP + DOM)**, 12 s loop, tiles **clickable** (pause on hover/focus), with a **visible pause control** | Live products and links; WCAG 2.2.2 requires a pause control for motion longer than 5 s |
| 19 | "Most scrolled" | Two metrics: **listing impressions** (tile ≥50% visible for ≥1 s, deduped per session) and **PDP scroll depth** (milestones 25/50/75/100) | Adopts the spec's own suggestion and makes it measurable |
| 20 | Wishlist without account | Guests: device-only (`localStorage`). On login it **merges** into the account | Satisfies FR-27 for everyone |
| 21 | Notification channels | **Email is required at launch** (Resend). **WhatsApp utility templates** sit behind an adapter (provider TBD). **SMS deferred**: India needs TRAI DLT registration first | Lowest-risk path to FR-11 |
| 22 | Courier | **Manual fulfilment at launch** (admin enters courier, AWB and tracking URL). **Shiprocket adapter** is a later phase | FR-23 works on day one; the integration is additive |
| 23 | Analytics | **First-party anonymous event table** (feeds admin reports and insights) plus **optional GA4, behind consent**. Vercel Speed Insights for Web Vitals | FR-18 and FR-26 without leaking PII or payment data |

---

## 2. Spec conflicts and gaps — resolutions

| Conflict / gap (spec ref) | Resolution |
|---|---|
| **Product types**: §1 and §4 list 4 (Charms, Hippers, 3D Stickers, DIY), but §5 and the sitemap list "3 type pages" (no Charms) | Types are a **data table**, and one page is generated per type, so all 4 get pages. The owner can archive "Charms" if it was meant as an umbrella term |
| **Cart shows discounts (Must) but coupons FR-14 are Should** (§14 contradiction 1) | **Raise FR-14 to Must.** It is cheap on a custom build. The discount line renders only when a discount applies |
| **Wishlist Must on PDP vs accounts Decide** (contradiction 2) | Guest wishlist on the device, merged on login (decision 20) |
| **"Most scrolled" has no requirement** (contradiction 3) | FR-26 with the definition in decision 19 |
| **Hero reference colours red/blue/black** (contradiction 4) | All hero colours come from the active vibe's tokens |
| **Cart "tax" line vs Indian B2C pricing law** | B2C prices **must be displayed inclusive of all taxes** (Legal Metrology MRP rules). Tax is **never added on top**: cart and checkout show "Includes ₹X GST", and the invoice shows the CGST/SGST or IGST split. This settles most of decision 6 |
| **Compare-at price vs MRP** | Map spec "compare-at" → **`mrp_paise`** (legal MRP), with `price_paise ≤ mrp_paise` enforced. Strike-through shows only when price < MRP, never as a fake "was" price (dark-pattern rules) |
| **Home page (Must) contains the animated hero, but FR-21 is Should** | **Static poster hero = Must** (ships first). The animation is layered on later and degrades to the poster |
| **FR-19/20 "Must if adopted"** | The hand button is "Decided", so both are **Must** |
| **FR-19 under 400 ms vs "load only the active theme's font"** | Preload the **next** theme's font and texture at idle (the cycle is fixed). The switch awaits `document.fonts.load()` for at most 120 ms, then a ~250 ms cross-fade. Budget measured in e2e tests |
| **`?vibe=` in URL vs "no duplicate indexed pages"** | The URL always reflects the vibe via `history.replaceState`. **Canonical URLs never include `?vibe`**. Persistence uses the `ifonli_vibe` cookie plus `localStorage`, which hold no personal data |
| **"Theme applies to every storefront page" vs "Buy pages take colours only"** | Tokens are split into **palette** and **shape/type/texture** groups. Buy pages (cart, checkout, confirmation, tracking) set `data-vibe-scope="buy"`, which resets shape/type/texture to base. The checkout header is minimal: logo, secure badge, back to cart, **no hand button** |
| **Vibe collection page while a different site theme is active** (e.g. `/vibes/gothic` in Cute) | The page **does not hijack** the user's theme. Its header section renders in the collection's own tokens (scoped `data-vibe` on the section), with a "Wear this vibe" button that switches the site |
| **"One hero variant per theme = 5x the animation work"** | One parameterised timeline plus 5 **motion profiles** (palette, easing personality, connector style). Structure is written once |
| **Scene 8 (brush strokes) has no product equivalent** | Replaced by a **product-silhouette burst** (tiles masked to silhouettes radiating out) |
| **29 s reference vs 8–12 s target** | 12 s loop with scene timings set in §9 |
| **§1 says the business team manages "queries" but no FR covers it** | Add a **contact inbox** and a **"Report a problem" support case** (damaged/defective/wrong/missing, with photo upload). This also covers the consumer-rights note under §8 |
| **Product record missing legal fields** | Add Legal Metrology and E-Commerce Rules fields: country of origin, manufacturer/packer/importer (store default plus override), net quantity, dimensions, HSN, GST rate (see §3) |
| **Support/fulfilment role (Should)** | RBAC roles `owner`, `admin`, `fulfilment` are built in from the start. It costs little |
| **Search/filters "Should"** | Built in v1 (Postgres FTS). Cheap on a custom build and core to the "discover by mood" goal |

---

## 3. India compliance findings to build in (flag to owner; legal review required)

Spec §10 requires the developer to flag these. Each item becomes a field, page or behaviour; the actual wording comes from the owner or their lawyer.

- **Consumer Protection (E-Commerce) Rules 2020**: show legal entity name, registered address, customer-care email and phone, and the **grievance officer's name, designation and contact** (acknowledge within 48 h, resolve within 1 month). Show return, refund, exchange, delivery and payment terms before purchase, plus the **total price with every charge broken out**, and the country of origin. All of these become *Store details* settings rendered in the footer and on the Help and Policy pages.
- **Legal Metrology (Packaged Commodities) Rules, e-commerce provisions**: the product page shows MRP (incl. all taxes), net quantity, manufacturer/packer/importer name and address, country of origin, and consumer-care details. One source reports a 2026 amendment adding a country-of-origin **filter**. That source is unverified, so the "Made in" filter is added cheaply anyway.
- **CCPA Dark Patterns Guidelines 2023**: no false urgency (low-stock badges only from real stock), no basket sneaking, no drip pricing (shipping estimate shown in the cart), no confirm-shaming (**applies to themed copy**, Overthinking especially), no pre-ticked consents. A copy review checklist ships with the copy dictionaries.
- **DPDP Act 2023 / Rules 2025**: substantive obligations commence ~May 2027, so design for them now. Plain-language privacy notice, minimal data collection, consent for non-essential analytics, account deletion and data export, documented retention. Theme cookie holds no personal data.
- **No-return policy (spec §8 legal note)**: summary shown on the PDP, in the cart and in checkout, with a required acknowledgement checkbox at checkout. "Report a problem" stays available because statutory rights for defective, damaged or wrong goods still apply.
- **GST**: rates for imitation jewellery (HSN 7117) and stickers (Ch. 48/49) **conflict across sources after the Sept 2025 rate reform**. Rates are **per-product admin fields set by the owner's CA**, never hard-coded. Registration may not be mandatory below threshold for an own-website seller, so the invoice template supports both "Tax invoice" (with GSTIN) and "Bill of supply" (without). Owner takes professional advice.
- **Payments**: Razorpay hosted checkout means no card data touches IfOnli (PCI SAQ-A scope). **Razorpay activation (KYC) checks that contact, terms, privacy, refund and shipping policy pages are live on the site**, so a staging site with policy pages must go up early (Phase 2).

---

## 4. Architecture and stack

Single Next.js app, one deployment. Server Components by default, Server Actions for mutations, Route Handlers only for webhooks, cron and the analytics beacon.

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router, Turbopack, `cacheComponents: true`), **React 19**, TypeScript strict | Pin the latest 16.x at kickoff. `proxy.ts` (replaces middleware) for coarse auth gating |
| Styling | **Tailwind CSS v4** whose `@theme` maps to **CSS custom properties**; vibe overrides under `[data-vibe=…]` | Components use semantic tokens only; a lint rule bans raw hex in components |
| DB | **Supabase Postgres** via **Drizzle ORM** + drizzle-kit migrations (postgres.js, pooled URL) | All DB access is server-side; RLS is not relied on (service role stays server-only) |
| Storage | **Supabase Storage** buckets: `products` (public), `cutouts` (public), `content` (public), `private` (support photos, invoices) | Signed upload URLs from admin; `next/image` with `remotePatterns` |
| Auth | **Better Auth** (Drizzle adapter): `emailOTP` (customers and admins), `admin` (roles), `twoFactor` (TOTP, **mandatory for admin roles**) | Verify plugin APIs against current docs at kickoff |
| Payments | **Razorpay** Orders API + Checkout.js (lazy-loaded), `razorpay` Node SDK, webhooks | `theme.color` = active vibe accent |
| Email | **Resend** + **React Email** templates | SPF/DKIM/DMARC on the sending domain |
| WhatsApp (later) | Adapter interface. Provider TBD (MSG91 / Interakt / AiSensy; ~₹0.12–0.15 per utility message) | Needs Meta business verification and template approval |
| Shipping (later) | Adapter interface: `manual` (launch), `shiprocket` (phase 9) | Serviceability at launch from our own pincode table |
| Motion | **GSAP 3** (free incl. all plugins since Apr 2025) for the hero only, lazy chunk. **View Transitions API** for the theme cross-fade (Baseline: Chrome, Safari 18, Firefox 144) | No animation library in the main bundle |
| Admin UI | **shadcn/ui** + TanStack Table + react-hook-form + **Zod** (shared schemas) | Admin is never themed |
| Testing | **Vitest** (unit/integration on a test DB), **Playwright** (e2e, visual), **@axe-core/playwright**, **Lighthouse CI** | See §16 |
| Ops | Vercel (Pro: Hobby forbids commercial use), Vercel Cron, Sentry (errors), Supabase daily backups + weekly `pg_dump` to private storage via GitHub Action | |

**Money**: integer **paise** everywhere (`bigint`), one `money.ts` helper (format `₹1,299` via `Intl.NumberFormat('en-IN')`). No floats.

**Caching**: catalogue reads use `'use cache'` + `cacheTag('product:{id}' | 'collection:{slug}' | 'content' | 'settings')`. Admin mutations call `updateTag`/`revalidateTag`. **Live stock on the PDP** renders in an uncached Suspense hole. Stock is always re-validated server-side at add-to-cart and checkout regardless of cache.

---

## 5. Repository layout

```
ifonli/
  src/app/
    (store)/            layout = header (hand button), footer; data-vibe-scope="full"
      page.tsx                  home
      shop/page.tsx             all products (+filters)
      vibes/[vibe]/page.tsx     5 vibe collections
      types/[type]/page.tsx     4 product-type collections
      products/[slug]/page.tsx  PDP
      search/page.tsx           (noindex)
      wishlist/page.tsx
      help/page.tsx             contact form + FAQ
      policies/[slug]/page.tsx  shipping, cancellation, returns-refunds, privacy, terms, seller-information
      account/(login|orders|orders/[ref]|addresses|profile)/…
    (buy)/              layout = data-vibe-scope="buy" (colours only)
      cart/page.tsx
      checkout/page.tsx         minimal header, no hand button
      orders/[ref]/page.tsx     confirmation + status (guest via signed token)
      track/page.tsx            lookup by ref + email/phone
    admin/              unthemed layout, noindex, RBAC
      (dashboard|products|collections|inventory|orders|discounts|content|faq|policies|
       customers|support|reports|insights|settings|users|audit)/…
    api/
      webhooks/razorpay/route.ts
      payments/razorpay/verify/route.ts
      events/route.ts           analytics beacon (batched)
      cron/(release-reservations|reconcile-payments|rollup-analytics|notify-retry|low-stock-digest)/route.ts
    sitemap.ts, robots.ts, opengraph-image.tsx (per product, vibe-coloured)
  src/server/
    db/{index.ts, schema/*.ts}
    services/{catalog,search,cart,pricing,coupons,inventory,orders,payments,refunds,shipping,
              notifications,content,settings,analytics,insights,support,audit}.ts
    payments/{provider.ts, razorpay.ts}
    shipping/{provider.ts, manual.ts, shiprocket.ts}
    notify/{channel.ts, email.ts, whatsapp.ts, outbox.ts}
    auth/{auth.ts, permissions.ts}
  src/features/vibe/{vibes.ts, VibeHeadScript.tsx, HandButton.tsx, useVibe.ts, VibeText.tsx,
                     VibeScope.tsx, copy/{base,cute,bold,overthinking,gothic,funky}.ts}
  src/features/hero/{HeroPoster.tsx, HeroStage.tsx (lazy), timeline.ts, scenes/*.ts, profiles/*.ts}
  src/components/{ui (token-driven primitives), store, admin (shadcn)}
  src/styles/{globals.css, tokens/{base,cute,bold,overthinking,gothic,funky}.css, textures/*.svg}
  public/fonts/*.woff2 (self-hosted, latin subset), public/cursors/*
  emails/*.tsx
  drizzle/ (migrations)
  scripts/{seed.ts, import-pincodes.ts, contrast-check.ts, make-placeholder-cutouts.ts}
  tests/{unit,integration,e2e,visual}
  docs/{DECISIONS.md, OWNER-INPUTS.md, RUNBOOK.md, ARCHITECTURE.md, ADMIN-GUIDE.md, LAUNCH-CHECKLIST.md}
```

---

## 6. Data model (Drizzle / Postgres)

All tables have `id` (uuid v7), `created_at` and `updated_at`. Money columns are `*_paise bigint`.

**Catalogue**
- `vibes` (slug, name, sort, description, seo_title, seo_desc, hero_copy) — 5 seeded
- `product_types` (slug, name, **definition**, sort, seo_*) — 4 seeded
- `products` (slug unique, name, description_md, type_id, status `draft|active|archived`, seo_title, seo_desc, hsn_code, gst_rate_bp, country_of_origin, net_quantity, dimensions, manufacturer_override jsonb, is_kit bool, search_tsv generated)
- `product_vibes` (product_id, vibe_id, featured_rank nullable) PK(product_id, vibe_id)
- `product_options` (product_id, name, position) / `product_option_values` (option_id, value, swatch_hex, position)
- `variants` (product_id, **sku unique**, title, option_value_ids, price_paise, mrp_paise, **stock_on_hand int ≥ 0**, low_stock_threshold nullable (→ setting), weight_g, active, position)
- `product_images` (product_id, variant_id nullable, kind `photo|cutout`, path, alt (required), width, height, position)
- `bundle_components` (kit_variant_id, component_variant_id, qty) — **schema only, unused in v1**

**Inventory**
- `inventory_movements` (variant_id, delta, reason `sale|restock|adjust|cancel_restock|return_restock|correction`, order_id, actor_id, note) — every stock change goes through here (ledger)
- `stock_reservations` (order_id, variant_id, qty, expires_at, status `active|converted|released`). **Available = on_hand − Σ active unexpired reservations**, so correctness never depends on cron

**Customers**
- Better Auth tables (`user` with `role`, `session`, `account`, `verification`, `twoFactor`)
- `customer_profiles` (user_id, phone, marketing_opt_in, deleted_at)
- `addresses` (user_id, name, phone, line1, line2, landmark, city, state, pincode, is_default)
- `wishlist_items` (user_id, product_id)

**Carts and orders**
- `carts` (token unique (httpOnly cookie), user_id nullable, coupon_code, version int) / `cart_items` (cart_id, variant_id, qty)
- `orders` (**ref unique** e.g. `IFO-2611-7K3Q`, user_id nullable, email, phone, **status**, **payment_status**, **fulfillment_status**, payment_method `razorpay|cod`, subtotal/discount/shipping/cod_fee/total/tax_included `_paise`, coupon_code, shipping_address jsonb (snapshot), billing_address jsonb, **vibe_at_order**, access_token_hash, idempotency_key unique, policy_ack_version, placed_at, paid_at, cancelled_at, expires_at)
- `order_items` (order_id, variant_id, snapshot: product_name, variant_title, sku, image_path, unit_price_paise, mrp_paise, qty, discount_alloc_paise, line_total_paise, hsn, gst_rate_bp, tax_paise)
- `payments` (order_id, provider, **provider_order_id unique**, provider_payment_id unique nullable, amount_paise, status `created|authorized|captured|failed`, method, raw jsonb)
- `refunds` (order_id, payment_id nullable (manual COD refunds), provider_refund_id, amount_paise, reason, status `pending|processed|failed|manual`, actor_id, reference)
- `webhook_events` (**provider_event_id unique**, type, payload, processed_at, error) — idempotency
- `shipments` (order_id, courier, awb, tracking_url, status, shipped_at, delivered_at, events jsonb)
- `order_events` (order_id, type, from→to, note, actor_id, visible_to_customer bool) — the timeline
- `invoices` (order_id, number (sequential per FY, e.g. `IFO/26-27/000123`), kind `tax_invoice|bill_of_supply`, pdf_path)

**Promotions**
- `coupons` (code citext unique, kind `percent|fixed|free_shipping`, value, starts_at, ends_at, min_subtotal_paise, max_discount_paise, usage_limit, per_customer_limit, scope jsonb {vibes, types, products, exclude_products}, stackable bool (v1: false; one coupon per order), active)
- `coupon_redemptions` (coupon_id, order_id, email, status `reserved|confirmed|released`)

**Content and operations**
- `banners` (vibe_id nullable = all, placement `home_offer|announcement`, title, body, image_path, link, starts_at, ends_at, position, active)
- `featured_slots` (vibe_id, placement `home_featured|hero_tiles`, product_id, rank)
- `faqs` (category `delivery|payment|product|orders`, question, answer_md, position, published)
- `policies` (slug, title, body_md, version, effective_at, published) + `policy_versions` (history)
- `settings` (key, value jsonb, updated_by) — §14
- `contact_messages` (name, email, phone, order_ref, message, status `new|open|closed`, assigned_to)
- `support_cases` (order_id, type `damaged|defective|wrong|missing|other`, description, photo_paths, status, resolution `refund|replacement|rejected`, notes)
- `notification_outbox` (order_id, channel, template, to, payload, status `pending|sent|failed`, attempts, provider_id, last_error)
- `pincodes` (pincode, district, state, zone, serviceable bool, cod_allowed bool) — seeded from the data.gov.in All-India Pincode Directory (OGD licence)
- `analytics_events` (session_id (random, anon), event, product_id, vibe, path, value int, meta jsonb, ts) + `product_engagement_daily` (date, product_id, impressions, pdp_views, unique_viewers, avg_scroll_depth, reached_75_pct, add_to_carts)
- `admin_audit_log` (actor_id, action, entity, entity_id, diff jsonb, ip)
- `rate_limits` (key, window_start, count) — Postgres-based limiter for OTP, coupon, track lookup, contact and checkout

---

## 7. Core commerce flows

### 7.1 Pricing engine — `src/server/services/pricing.ts` (pure, fully unit-tested)
`price(cart, {coupon, pincode, paymentMethod, settings}) → { lines[], subtotal, discount (allocated per line pro-rata, rounding remainder to the largest line), shipping, codFee, taxIncluded (per-line: line_total − line_total/(1+rate)), total, messages[] }`. The **same function** runs in the cart, checkout and order creation. The server result is the only truth (FR-07).
- Shipping: `free if subtotal_after_discount ≥ free_threshold` else `flat_fee` (zone overrides optional). Free-shipping coupons zero it.
- COD fee: added only when `paymentMethod = cod`, shown as its own line.
- Tax display: "Includes ₹X GST". On the invoice: CGST + SGST if the buyer's state equals `store.state`, else IGST. Shipping and COD fee are taxed at the order's dominant line rate (configurable; CA to confirm).

### 7.2 Cart
Server-side cart keyed by an httpOnly `cart_token` cookie, shown in a slide-over drawer and a full `/cart` page. Add, update and remove are Server Actions that **validate availability** and cap quantity at `min(available, settings.max_qty_per_line)`. Optimistic UI uses `useOptimistic`. On view, the cart re-validates and shows inline notices ("Only 2 left — we updated your quantity"). On login, the guest cart **merges** into the user cart. A shipping estimate (or "Free shipping above ₹X") is shown in the cart to avoid drip pricing.

### 7.3 Coupons (FR-14)
`validateCoupon(code, cart, email)` checks: active, within dates, `min_subtotal`, scope eligibility (vibes/types/products/exclusions), total and per-email usage limits, no stacking. Errors are specific and human ("This code starts on 1 Nov", "Add ₹150 more to use SAVE10"). The redemption is **reserved** at order creation, **confirmed** on payment or COD placement, and **released** on expiry or cancellation.

### 7.4 Checkout (single page, one layout in every theme)
Sections: **Contact** (email, phone +91 validation) → **Delivery address** (pincode first, autofills city/state from `pincodes`, checks serviceability and COD eligibility live, shows the delivery estimate) → **Shipping option** → **Payment** (Razorpay | COD if eligible) → **Review** (items, subtotal, discount, shipping, COD fee, "Includes GST", **Total payable**). A **policy acknowledgement checkbox** (unticked) links returns/terms/privacy. CTA: "Pay ₹X securely" or "Place COD order ₹X". Logged-in users pick saved addresses. Zod schemas are shared client and server. Error messages are human and specific (FR-08), focus moves to the first error, and an `aria-live` summary announces it.

### 7.5 Order creation + stock reservation (FR-06, FR-10) — `orders.createFromCart()`
1. Re-price (7.1), re-validate the coupon, address, serviceability and COD eligibility.
2. **Idempotency**: the form carries an `idempotency_key` (cart version + uuid). A repeat submit returns the existing pending order.
3. **DB transaction**: `SELECT … FROM variants WHERE id IN (…) ORDER BY id FOR UPDATE` (deterministic lock order prevents deadlocks). Compute availability; if anything is short, abort with a per-item error. Insert `orders` (status `pending_payment`, or `confirmed` for COD), `order_items` snapshots, then:
   - **Prepaid**: insert `stock_reservations` with `expires_at = now + settings.reservation_ttl`.
   - **COD**: decrement `stock_on_hand` directly (movement `sale`).
4. **Prepaid**: create the Razorpay Order **outside** the transaction (`amount` in paise, `currency: INR`, `receipt: ref`, `notes.order_id`). On API failure, release the reservation and show a retry. Store `payments(provider_order_id)`.
5. Return `{ keyId, razorpayOrderId, amount, prefill, theme.color }`. The client lazy-loads `checkout.razorpay.com/v1/checkout.js` and opens it.

### 7.6 Payment confirmation (FR-09) — never mark paid without a verified capture
- **Client handler** → `POST /api/payments/razorpay/verify`: HMAC-SHA256(`order_id|payment_id`, **key_secret**), compared with `timingSafeEqual`. Then **fetch the payment from the Razorpay API** and require `status=captured` (capture via the API if `authorized`), matching `order_id` and `amount`. Then call `finalizePaidOrder()`.
- **Webhook** `/api/webhooks/razorpay`: read the **raw body** (`await req.text()`), verify `X-Razorpay-Signature` with the **webhook secret** (a different secret from the key secret). Dedupe on the `x-razorpay-event-id` header via `webhook_events`. Events handled:
  - `payment.captured` / `order.paid` → `finalizePaidOrder`
  - `payment.failed` → record the attempt
  - `refund.processed` / `refund.failed` → update `refunds`
  - Respond 2xx fast.
- **`finalizePaidOrder(orderId, payment)`** runs in one transaction and is **idempotent**:
  - If the order is already paid with the same payment id → no-op.
  - If it is already paid with a **different** payment → mark it duplicate, **auto-refund** it, and alert admin (never charge twice).
  - Otherwise: convert reservations into `on_hand` decrements (movement `sale`), set payment `captured`, `payment_status=paid`, `status=confirmed`, confirm the coupon, assign the invoice number, write `order_events`, enqueue notifications in the **outbox**, and clear the cart.
- **Late capture after expiry**: try to re-reserve. If stock is there, finalize. Otherwise auto-refund in full, email an apology and alert admin.
- **Dismissed or failed payment**: the order stays `pending_payment`. The page shows "Payment not completed — Retry" (re-opens Checkout with the same Razorpay order while the reservation is valid). On expiry: `status=expired`, reservation and coupon released.
- **Cron backstop** `reconcile-payments` (every 10 min): for `pending_payment` orders older than 5 min, `GET /orders/{id}/payments` on Razorpay and finalize or expire.
- **Owner setting**: confirm auto-capture is ON in the Razorpay dashboard.

### 7.7 Order state machine — `orders/state.ts` (table-driven, unit-tested)
Three independent axes, with an allowed-transition map:
- `status`: `pending_payment → confirmed → processing → completed`; branches `cancelled`, `expired`
- `payment_status`: `unpaid | paid | failed | cod_pending | cod_collected | partially_refunded | refunded`
- `fulfillment_status`: `unfulfilled → packed → shipped → out_for_delivery → delivered`; branches `rto`, `returned`

Customer-facing label mapping: Payment pending · Confirmed · Packed · Shipped · Out for delivery · Delivered · Cancelled · Refunded. Every transition writes `order_events` and, where configured, a notification.

### 7.8 Cancellations, refunds and support (FR-25)
- **Customer cancel**: allowed while `fulfillment_status ∈ settings.cancellable_statuses` (placeholder: `unfulfilled`). Prepaid → automatic full Razorpay refund. COD → cancel only. Stock restocked (movement `cancel_restock`).
- **Admin cancel/refund**: full or partial amount (≤ captured − refunded), reason, a "restock items" toggle per line. Razorpay `payments.refund` creates a `refunds` row (`pending`); the webhook moves it to `processed`. **COD refunds** are recorded as `manual` with a UPI/bank reference. The customer is notified at initiation and on completion.
- **Support case** (from the order page): type plus photos into the private bucket. Admin resolves with refund (above), replacement (creates a ₹0 linked order that decrements stock) or rejection with a note.

### 7.9 COD
Eligible when `settings.cod_enabled`, the pincode has `cod_allowed`, `total ≤ cod_max_order_value`, and no excluded items. The order is created `confirmed / cod_pending` with stock decremented immediately. Admin marks **COD collected** after delivery (or later via Shiprocket remittance webhook). An OTP/WhatsApp confirmation for COD (to cut returned-to-origin orders) is a later item behind the WhatsApp adapter.

### 7.10 Notifications (FR-11) — outbox pattern
State changes write `notification_outbox` rows **inside the same transaction**. The sender runs right after commit and the `notify-retry` cron retries failures with backoff. Templates use React Email and are **styled in `vibe_at_order`'s palette** (signature touch); content stays neutral.

Customer events: order confirmed (prepaid) / COD order placed · payment failed (optional) · shipped (courier + AWB + link) · delivered · cancelled · refund initiated / processed · support case update · login OTP · contact acknowledgement.

Admin events: new order · low-stock daily digest · payment anomaly (duplicate or late-refund) · new support case.

The WhatsApp channel mirrors the transactional events once a provider and templates are approved.

### 7.11 Order tracking (FR-23)
`/track`: ref plus email or phone (rate-limited) → status timeline, courier, AWB and tracking link (built from the courier's URL template). Logged-in users see the same view under `/account/orders/[ref]`. Confirmation links carry a signed `?t=` token (hash stored, constant-time compare).

### 7.12 Invoices
A PDF (`@react-pdf/renderer`) is generated on confirmation, stored privately, downloaded through a short-lived signed URL, and attached to the confirmation email. Sequential number per financial year. Format is "Tax invoice" when `store.gstin` is set, otherwise "Bill of supply".

---

## 8. Vibe theme system (FR-19, FR-20)

### 8.1 Tokens
`tokens/base.css` defines every semantic variable. Each vibe file overrides them under `[data-vibe="x"]`. Two groups:
- **Palette** (always applied, including Buy pages): `--bg, --surface, --surface-2, --ink, --ink-muted, --accent, --on-accent, --accent-2, --accent-3, --border, --focus-ring, --success, --warning, --danger, --price, --sale`
- **Shape/type/texture** (reset to base under `[data-vibe-scope="buy"]`): `--font-display, --display-weight, --display-tracking, --radius-card, --radius-button, --radius-input, --border-w, --shadow-card, --shadow-button, --texture-bg, --icon-stroke, --icon-linecap, --icon-filter, --cursor, --motion-ease, --motion-dur`

Body font is **shared** (one variable woff2, e.g. Figtree, pending brand). Only `--font-display` changes per vibe. Any element can carry `data-vibe` to scope tokens locally (vibe chips, the vibe collection header, the vibe-coloured OG image).

### 8.2 Starter looks (proposals; replace with brand assets; all pairs contrast-checked in CI)

| Vibe | Palette idea | Display font (OFL) | Shape / texture / icon |
|---|---|---|---|
| Cute | blush `#FFF4F8` bg, plum ink `#3B2340`, raspberry button `#C2185B` (white text), pastels butter/baby-blue/lavender | Fredoka or Baloo 2 | pill buttons, 24px cards, soft pink shadows, sparkle SVG sprinkles, rounded 2px icons |
| Bold | white bg, `#0A0A0A` ink, saturated red `#E10600`, yellow `#FFD400`, blue `#0047FF` blocks | Archivo (wdth 125, wght 900) | radius 0, 3px ink borders, hard offset shadow `6px 6px 0`, 2.5px square-cap icons |
| Overthinking | notebook `#F7F5EE` with ruled-line texture and red margin, graphite-blue ink `#2B3A4A`, muted blue `#3D5A80`, highlighter `#FFF59D` | Kalam or Caveat (headlines), crossed-out words via `<s>` | hand-drawn irregular radii, scribble underline SVGs, thought-bubble tooltips, `--icon-filter: url(#wobble)` (feTurbulence) |
| Gothic | near-black `#0E0B10` bg, `#1A1420` surface, bone ink `#EDE6F0`, oxblood `#8B1E3F` surfaces, rose link `#E58BA9` | Grenze Gotisch (display only, large sizes) or Cormorant | sharp 2px radii, lace SVG texture, candle-glow vignette, thin sharp icons |
| Funky | cream `#FFF1D6` bg, deep purple ink `#2A1B3D`, orange `#FF5E1A`, teal `#00B3A4`, mustard `#FFC800`, magenta `#E83F8C` | Shrikhand | retro 70s wave texture, pill buttons with stacked multi-colour shadows, warped headline via SVG displacement filter |

Textures are SVG under 30 KB each. Custom cursor (optional, Could) is a pure-CSS `cursor:url()` per vibe, disabled on touch and under reduced motion.

### 8.3 No-flash rendering with static pages
- `VibeHeadScript` is an inline, blocking script in `<head>` (≈600 bytes). It resolves the vibe as `?vibe=` → cookie `ifonli_vibe` → `localStorage` → `settings.default_vibe` (injected at build/revalidate), sets `<html data-vibe>`, writes the cookie if the vibe came from the URL, and injects `<link rel=preload as=font>` for the active display font. Pages stay **static/cached**; no request-time cookie reads.
- **Vibe-dependent content renders for all five vibes; CSS shows the active one.**
  - `VibeText` renders short copy variants, toggled by `[data-vibe=x] [data-v=x]{display:revert}`.
  - Home featured sets render 5 × 8 cards.
  - Hero poster tile sets render 5 × ≤14 tiles.
  - Hidden images use `loading=lazy`, so only the active set downloads. Switching needs **zero network round-trips for content**, which is what makes the 400 ms budget achievable. The default vibe's copy comes first in the DOM for SEO.
- The interactive vibe state uses `useSyncExternalStore` over the `data-vibe` attribute (no hydration mismatch).

### 8.4 Hand button — `HandButton.tsx`
- A real `<button>` in the header, top-left on all breakpoints.
  - **Visible**: a vibe-specific hand SVG (5 variants) and the current vibe name.
  - `aria-label`: "Change vibe, current: Cute, next: Bold".
  - Hover tooltip, or long-press (500 ms) on touch: "Next: Bold".
- **Click sequence**:
  1. Compute the next vibe from `vibe_cycle` (wraps).
  2. Await the next font, max 120 ms (it is usually already preloaded).
  3. Run `document.startViewTransition(() => apply(next))` with a ~250 ms root cross-fade. The hand plays a 250 ms flick (rotate −18° → 8° → 0).
  4. Update the cookie (1 yr, `SameSite=Lax`), `localStorage`, `history.replaceState` (`?vibe=`) and `aria-live` ("Vibe changed to Bold").
  5. Fire analytics `vibe_switch {from,to,path}`.
  6. Idle-preload the **following** vibe's font, texture and first 4 featured images.
- **Reduced motion, or View Transitions unsupported**: instant swap, no flick.
- **Keyboard**: Enter and Space. Focus ring uses `--focus-ring` (contrast-checked per vibe).
- After every client navigation, `replaceState` keeps `?vibe=` on the URL so any copied link shares the theme. `<link rel="canonical">` never includes it, and analytics strips it from the page path.

### 8.5 Copy tone
`copy/{vibe}.ts` dictionaries share a TypeScript key type (missing keys fail the build). Scope is expressive surfaces only: hero headline/sub, section titles, empty cart, no-results, 404/500, wishlist empty, add-to-cart toast, the "Wear this vibe" CTA. **Checkout, payment, legal, error-critical and notification copy are neutral and fixed.** The dark-pattern copy checklist is applied in review (no confirm-shaming, no fake urgency).

---

## 9. Animated hero (FR-21)

- **Poster first (Must)**: `HeroPoster` is a server-rendered static composition (the scene 9 "grid" rest frame) of product cutouts on vibe-coloured square/circle backings. Headline and **Shop button** sit in a separate top layer that is **never animated away**. The LCP element is the headline text (fast); tile images get `fetchpriority=low` except the first 4.
- **Enhancement**: `HeroStage` is imported dynamically **only if** the hero is in the viewport, `prefers-reduced-motion` is not `reduce`, `navigator.connection.saveData` is false, effectiveType ≠ 2g, after `requestIdleCallback`. Chunk budget ≤ 70 KB gzip (gsap core + Flip + DrawSVG). Pauses when off-screen (IntersectionObserver) or when the tab is hidden.
- **One parameterised GSAP timeline** (`timeline.ts`) built from scene modules. **12 s loop** (approximate):

| # | Scene (reference → IfOnli) | Duration |
|---|---|---|
| 1 | One tile on a design-tool canvas: paper texture, grid, anchor points, selection handles | 1.2 s |
| 2 | Splits into a pair with connector lines; frame morphs square → rounded → circle | 1.2 s |
| 3 | Small tiles fan out on spokes; 2–3 large highlighted hero tiles | 1.4 s |
| 4 | Dark transition: 3D tile rotation with shadow streaks, one horizontal echo | 1.0 s |
| 5 | Dense collage zooms to fill, then a cross-dissolve (no hard cut) to a solid vibe colour + vibe badge | 1.2 s |
| 6 | Scatter, then swirl into spiral and ring clusters | 1.4 s |
| 7 | Snap into cross → checkerboard → strip with connector lines and anchor dots | 1.4 s |
| 8 | **Product-silhouette burst** (replaces brush strokes) | 0.8 s |
| 9 | Full-screen grid with a highlight wave (**rest frame = poster**, 1.2 s hold) | 1.6 s |
| 10 | Book-page flip back to the opening tile | 0.8 s |

- **Motion profiles** (`profiles/{vibe}.ts`) set palette tokens, easing and personality:
  - Cute: `back.out`/`elastic`, bouncy
  - Bold: `steps()`/`expo`, hard snaps
  - Overthinking: hesitation pauses, DrawSVG scribble connectors
  - Gothic: slow `sine`, fade-through-black, candle flicker
  - Funky: wobble/warp, 70s wave paths
- On a vibe switch the timeline crossfades to the new profile at the next scene boundary.
- **Tiles are `<a>` links to their products.** Hover or focus pauses the timeline and shows the product name. A **Pause/Play toggle** is visible bottom-right (WCAG 2.2.2). No flashing: luminance changes are cross-dissolves ≥200 ms, never >3 flashes/s (WCAG 2.3.1).
- **Data**: admin picks `featured_slots(placement='hero_tiles')` per vibe (needs ≥8 products with cutouts). Fallback: active products of that vibe with a cutout. Tiles repeat if there are fewer.
- **Cutout pipeline**: admin upload validates PNG/WebP **with an alpha channel** (`sharp().metadata().hasAlpha`), ≥1200 px, roughly square, and warns otherwise. Until real photography exists, `scripts/make-placeholder-cutouts.ts` generates SVG charm/sticker silhouettes flagged `is_placeholder` (launch blocks while any remain).

---

## 10. Storefront pages (spec §5 → routes)

| Page | Route | Key contents / states |
|---|---|---|
| Home | `/` | Header (hand, nav: Vibes ▾, Types ▾, Search, Account, Wishlist, Cart), hero, 5 vibe collection cards (each in its own scoped tokens), **featured products for the active vibe**, offers/banners, type links, footer (policies, grievance officer, contact, legal entity) |
| Shop / collections | `/shop`, `/vibes/[vibe]`, `/types/[type]` | Collection header (vibe pages in their own scoped tokens + "Wear this vibe"), product grid, filters (vibe, type, price, availability, made in), sort (featured, newest, price ↑↓), "load more", empty state |
| Product detail | `/products/[slug]` | Gallery (consistent ratio, zoom, swipe), name, price and MRP "incl. of all taxes", variant selector (swatches), live stock status (Suspense), qty stepper, **Add to cart** (sticky on mobile), wishlist heart, vibe chips, type, description, **legal block** (net qty, origin, manufacturer, care), return-policy summary, delivery estimate by pincode, related products (same vibe), JSON-LD |
| Search | `/search?q=` | Same grid and filters, typo tolerance, themed no-results with suggestions (popular in the active vibe), `noindex,follow` |
| Cart | `/cart` + drawer | Lines, qty edit, remove, stock notices, coupon field, subtotal, discount (only if applied), shipping estimate, "Includes GST", total, return-policy note, checkout CTA |
| Checkout | `/checkout` | §7.4. Minimal header, colours only |
| Confirmation | `/orders/[ref]` | Ref, items, amounts, payment and order status, next steps, invoice download, "Report a problem", "Create account" (prefilled email, guests only) |
| Tracking | `/track` | §7.11 |
| Help | `/help` | Contact form (→ inbox), support email/phone, response time, FAQ accordion by category (admin-managed) |
| Policies | `/policies/[slug]` | Shipping, cancellation, returns & refunds, privacy, terms and conditions, seller information. Version and effective date shown. **Linked from the footer, cart, checkout and PDP** (FR-15) |
| Account | `/account/*` | Email-OTP login, profile, addresses CRUD, order history and detail, wishlist, delete account, export data |
| Wishlist | `/wishlist` | Guest (device) or synced |
| Errors | `not-found.tsx`, `error.tsx` | Themed copy, search box, vibe links |

Global states everywhere: loading skeletons (token-shaped), empty, error (retry), success toasts, offline notice.

---

## 11. Admin panel (`/admin`, never themed, `noindex`, RBAC)

**Permissions** (in `permissions.ts`; checked in `proxy.ts` for routing **and** inside every Server Action):
- `owner`: everything, including users and settings
- `admin`: everything except users, settings and policy publishing
- `fulfilment`: orders (view, fulfilment updates, tracking, packing slips), support cases. **No** catalogue, pricing, coupons, settings or reports

All admin logins need TOTP 2FA. All mutations are written to `admin_audit_log`.

| Module | Features |
|---|---|
| Dashboard | Today/7d orders and revenue, AOV, orders awaiting fulfilment, low/out-of-stock count, open support cases, payment anomalies |
| Products | List (search, filter by vibe/type/status/stock), create/edit: details, markdown description, type, vibes (+ featured rank), options and variants matrix (SKU, price, MRP, stock, weight), images (drag-reorder, alt text required) and **cutouts** (alpha validation), SEO fields with live preview, legal fields, HSN/GST, kit flag, duplicate, archive |
| Collections | Edit vibe and type metadata (name, description, definition, SEO, sort); reorder featured products per vibe |
| Inventory | Stock table with on-hand / reserved / available, inline adjust with reason (ledger), low/out-of-stock filter (FR-13), CSV import/export |
| Orders | Filterable list (status axes, payment method, date, search by ref/email/phone), detail with timeline, status transitions (state-machine guarded), add shipment (courier, AWB, URL), mark COD collected, cancel, **refund full/partial**, resend notification, invoice, packing slip, internal notes |
| Discounts | Coupon CRUD (all §7.3 rules), usage stats |
| Site content | Banners (per vibe or global, schedule), announcement bar, featured products per vibe, hero tiles per vibe, FAQ CRUD and reorder (FR-24) |
| Policies | Markdown editor with preview, version history, effective date, publish (owner) |
| Customers | List, detail (orders, addresses), DPDP request handling (export/delete) |
| Support | Contact inbox and support cases (assign, status, resolve → refund/replacement) |
| Reports | Sales by day/week, orders by status, top products/vibes/types, coupon performance, funnel (sessions → PDP → add to cart → checkout → purchase) from first-party events, CSV export |
| Insights (FR-26) | Date-range picker and vibe filter. **Most viewed** (PDP views, unique viewers), **most seen in listings** (impressions), **scroll engagement** (avg depth, % reaching 75%), CTR (views/impressions), add-to-cart rate, vibe-switch counts, hero tile clicks |
| Settings | All §14 business rules, store/legal details, payment toggles, shipping rules, pincode serviceability upload |
| Users | Invite admin/fulfilment users, roles, 2FA status, deactivate |
| Audit | Read-only log |

---

## 12. Search, SEO, analytics, insights

- **Search**: generated `tsvector` (name A, SKU A, type and vibe names B, description C) + `unaccent` + `pg_trgm` similarity fallback for typos. Filters and sort live in URL params (shareable). Debounced instant results in the header search sheet.
- **SEO**:
  - `generateMetadata` on every page with admin-editable title and description
  - Clean slugs; product slug changes keep a redirect table
  - JSON-LD: `Product`/`Offer` (INR, availability), `BreadcrumbList`, `Organization`, `FAQPage`
  - Dynamic `sitemap.ts` (products, collections, policies); `robots.ts` disallows `/admin`, `/checkout`, `/account`, `/search`
  - Canonical strips `?vibe` and filter params; per-product OG image via `next/og` in the product's primary vibe colours
  - `lang="en-IN"`
- **Analytics (FR-18)**: the client batches events to `/api/events` with `navigator.sendBeacon`. The session id is random and stored in `sessionStorage`; no PII, no payment identifiers.
  - Events: `page_view, view_item_list (impression), view_item, scroll_depth, add_to_cart, remove_from_cart, view_cart, begin_checkout, add_shipping_info, add_payment_info, purchase (server-side, on finalize), vibe_switch, hero_play, hero_pause, hero_tile_click, search, wishlist_add`
  - The hourly `rollup-analytics` cron fills `product_engagement_daily`.
  - **GA4 is optional**, loads only after consent (minimal consent banner shown only if GA4 is enabled), with GA4 e-commerce event names mirrored.
  - Raw events are retained for 13 months (setting).

---

## 13. Security, performance, accessibility

**Security**
- HTTPS + HSTS; strict CSP with a nonce, allowing Razorpay origins (`checkout.razorpay.com`, `api.razorpay.com`; verify the exact list against Razorpay docs)
- Zod validation on every input; Server Action origin checks
- Rate limits on OTP, coupon, track and contact endpoints
- Webhook HMAC on the raw body; secrets only in Vercel env (separate test and live keys)
- Least-privilege roles, admin TOTP, audit log
- Signed URLs for private files; `sharp` re-encodes uploads (strips EXIF)
- Dependency updates via Renovate; Sentry with PII scrubbing

**Performance budgets** (proposed for owner agreement; Lighthouse mobile, Moto G Power, Slow 4G)
- Home and PDP perf ≥ 85, other pages ≥ 90
- LCP ≤ 2.5 s, CLS ≤ 0.05, INP ≤ 200 ms
- Initial JS ≤ 150 KB gzip (excluding the lazy hero chunk ≤ 70 KB)
- Each display font ≤ 40 KB (latin subset woff2); each texture ≤ 30 KB
- Images AVIF/WebP via `next/image` with explicit sizes

**Accessibility** (WCAG 2.2 AA, all 5 vibes)
- Semantic headings and landmarks, labelled form fields with error association, visible focus in every vibe
- Hand button and hero keyboard-operable; hero pause control; `prefers-reduced-motion` honoured everywhere
- Alt text required in admin; touch targets ≥ 44 px; skip link
- **Token contrast script** (`scripts/contrast-check.ts`) fails CI if any declared fg/bg pair is < 4.5:1 (text) or < 3:1 (UI/large text). Gothic and Funky get extra pairs

---

## 14. Business rules as settings (spec §8: owner supplies values; dev supplies placeholders marked `PLACEHOLDER`)

Each setting has a typed schema, an admin form, an audit trail, and a **launch gate**: production refuses to accept orders while any required setting is still `PLACEHOLDER` (an owner-only override exists for soft-launch testing).

| Group | Keys |
|---|---|
| Store/legal | legal_name, brand_name, registered_address, state (GST place of supply), gstin (optional), support_email, support_phone, support_hours, response_time, grievance_officer {name, designation, email, phone}, default_manufacturer {name, address}, default_country_of_origin |
| Pricing/tax | prices_include_gst (locked `true` for B2C), default_gst_rate_bp, shipping_tax_rule |
| Shipping | serviceability_mode `all_india|allowlist|denylist`, flat_fee, free_threshold, zone_overrides, processing_days, delivery_estimates_by_zone, delay_message |
| COD | cod_enabled, cod_fee, cod_max_order_value, cod_excluded_pincodes |
| Inventory | reservation_ttl_minutes, backorders (locked `false` per FR-06), default_low_stock_threshold, max_qty_per_line |
| Cancellation/returns | cancellable_statuses, return_policy_type `no_returns|returns_window`, returns_window_days, damaged_claim_window_hours |
| Accounts | guest_checkout_enabled (`true`), login_methods |
| Vibes | vibe_cycle, default_vibe, hero_enabled, custom_cursor_enabled |
| Notifications | channels per event (email, whatsapp), admin_alert_emails |
| Analytics | ga4_measurement_id, consent_required, event_retention_months |

---

## 15. Execution phases

Each phase ends in a merged PR with a Vercel preview, green CI, and its exit criteria met. Durations are effort estimates (solo dev + Claude Code), not commitments; the launch date is owner decision #5.

### Phase 0 — Setup (1–2 days)
- `git init`, private GitHub repo, branch protection
- `create-next-app` (TS, Tailwind v4, App Router, Turbopack); ESLint + Prettier, `tsconfig` strict, path aliases
- Supabase projects (`ifonli-dev` and `ifonli-prod`, Pro plan for prod); Vercel project linked (Pro); env vars scaffolded (`.env.example`)
- Drizzle setup, first migration, `scripts/seed.ts`, `scripts/import-pincodes.ts`
- CI (GitHub Actions): typecheck, lint, unit tests, contrast check, build; Playwright on preview URL
- `docs/DECISIONS.md` (all of §1–2), `docs/OWNER-INPUTS.md` (§17)

**Exit**: preview deploy renders "hello", DB migrates and seeds, CI green.

### Phase 1 — Foundations: tokens, vibe engine, shell (4–5 days)
- `tokens/*.css` for base + 5 vibes (palette vs shape groups, buy scope); Tailwind `@theme` mapping; ban-raw-hex lint rule
- Self-hosted fonts, `VibeHeadScript`, `useVibe`, `VibeText`, `VibeScope`, `HandButton` (all of §8.4), View Transitions + reduced-motion fallback
- Token-driven UI primitives: Button, IconButton, Input, Select, Checkbox, Radio, Stepper, Badge, Chip, Card, ProductCard, Price, Drawer, Dialog, Toast, Tooltip, Skeleton, Accordion, Tabs, EmptyState, Icon (sprite + stroke/filter tokens)
- Header (desktop and mobile), footer, nav menus, mobile menu sheet
- `/styleguide` (dev and preview only): every primitive in all 5 vibes side by side, plus buy scope
- Contrast-check script and Playwright test for the hand cycle (order, wrap, persistence, URL share, keyboard, <400 ms timing via `performance.mark`)

**Exit**: FR-19 acceptance tests pass on the shell; contrast CI green.

### Phase 2 — Design approval gate + early staging (3–5 days incl. owner review)
Spec §13 phase 2.
- Code-built wireframes of all pages, assembled with primitives and seed data
- Hero storyboard: 10 still frames per vibe exported from timeline keyframes
- Owner reviews the `/styleguide` and wireframes in all 5 vibes, then approves or adjusts tokens, fonts, hand SVGs and copy tone
- Deploy **staging with real policy page drafts, contact page and legal entity details** so the owner can **start Razorpay KYC** (activation takes days)

**Exit**: written owner approval of the visual direction (`docs/DECISIONS.md`). Razorpay application submitted.

### Phase 3 — Catalogue, browse, search + catalogue admin (6–8 days)
- Schema: catalogue, inventory, content, settings. Seed: 5 vibes, 4 types, ~30 placeholder products with variants and placeholder cutouts
- Services: catalog (cached + tags), search (FTS + trigram), inventory availability
- Pages: home (static poster hero, vibe cards, per-vibe featured sets, banners), `/shop`, `/vibes/[vibe]` (scoped header, "Wear this vibe"), `/types/[type]`, PDP (legal block, live stock hole, pincode delivery estimate), `/search`, filters/sort/pagination, 404
- Better Auth (admin roles + TOTP), `proxy.ts` gating, admin shell
- Admin: Products (full), Collections, Inventory (ledger), image/cutout upload with validation; tag revalidation on save
- SEO base: metadata, JSON-LD, sitemap, robots, canonical rule, OG images

**Exit**: FR-01–04, 13, 20, 22 pass. The owner can enter real products.

### Phase 4 — Cart, pricing, coupons, checkout, Razorpay, COD (8–10 days) ← highest risk, most tests
- Pricing engine + exhaustive unit tests (rounding, allocation, thresholds, COD fee, GST inclusive breakup)
- Server cart, drawer, `/cart`, merge-on-login stub, stock caps and notices
- Coupons service + admin Discounts module
- Checkout page (§7.4) with pincode autofill and serviceability, COD eligibility, policy acknowledgement
- `createFromCart` with locking, reservations, idempotency
- Razorpay order creation, Checkout.js integration, verify endpoint, webhook endpoint, `finalizePaidOrder`, duplicate auto-refund, late-capture handling, expiry
- Crons: release-reservations (cleanup), reconcile-payments
- Integration tests on a real test DB: **concurrent last-unit purchase** (N parallel `createFromCart`, exactly one succeeds), webhook replay idempotency, forged signature rejected, amount-mismatch rejected, verify-then-webhook and webhook-then-verify orderings

**Exit**: FR-05–10, 14 and every spec §12 payment acceptance test pass in Razorpay **test mode** (success, failure, dismiss, UPI pending → webhook, duplicate).

### Phase 5 — Orders lifecycle, notifications, tracking, accounts, wishlist (6–7 days)
- State machine + admin Orders module (timeline, transitions, shipments, COD collected, cancel, refunds full/partial + webhook), packing slip, invoice PDF and numbering
- Outbox + Resend + React Email templates (vibe_at_order palette) for every §7.10 event; notify-retry cron; admin alerts and low-stock digest
- Confirmation page (signed token), `/track`, customer cancel, "Report a problem" + support cases admin, contact form + inbox
- Accounts: email-OTP login, profile, addresses, order history, wishlist sync and merge, account deletion and export
- Fulfilment role verified end to end

**Exit**: FR-11, 12, 23, 25, 27 pass. Admin cancel/refund updates status and notifies (spec §12).

### Phase 6 — Site content admin, policies, reports, insights, analytics (5–6 days)
- Admin: banners, announcement bar, featured slots and hero tiles per vibe, FAQ, Policies (versioned), Settings (all §14 with launch gate), Users, Audit, Customers
- `/help`, `/policies/[slug]` rendering, policy links in footer, cart, checkout and PDP
- Event beacon, impression observer (≥50% for ≥1 s), PDP scroll-depth milestones, server-side purchase event, rollup cron; Reports and Insights screens; optional GA4 + consent banner

**Exit**: FR-15, 18, 24, 26 pass.

### Phase 7 — Animated hero (6–8 days)
- Scene modules 1–10, parameterised timeline, 5 motion profiles, profile switch at scene boundary
- Lazy-load conditions, off-screen and tab-hidden pause, hover/focus pause, Pause/Play control, clickable tiles, analytics hooks
- Reduced-motion = poster only; no flashes; performance pass (transform/opacity only, `will-change` scoped, ≤ 60 DOM tiles)

**Exit**: FR-21 passes. Lighthouse home mobile still ≥ 85 with the hero enabled. Shop button visible in every frame (visual test samples 12 timestamps).

### Phase 8 — Hardening, QA, launch (5–7 days)
- Full visual regression: every page × 5 vibes × {390, 768, 1440} widths
- axe scans on home, PDP, cart and checkout in every vibe
- Lighthouse CI budgets; security headers and CSP verified with live Razorpay; rate limits; Sentry; backups and restore drill (document in RUNBOOK)
- Copy review against the dark-pattern checklist; replace all placeholders; settings gate cleared by owner
- Live-mode smoke test: a real ₹1 test product purchased by UPI and card, then refunded; COD order placed and cancelled
- Domain + DNS, Resend domain auth, Google Search Console + sitemap submit
- Docs: ADMIN-GUIDE (+ recorded walkthrough), RUNBOOK (deploy, rollback, rotate keys, restore), ARCHITECTURE, known-issues list, test report

**Exit**: every spec §12 acceptance check passes with no open critical or high defects; owner sign-off.

### Phase 9 — Post-launch (optional, separately approved)
- Shiprocket adapter: live serviceability/ETD, create shipment + AWB + label, tracking webhooks, COD remittance
- WhatsApp utility notifications (provider + approved templates)
- COD confirmation via WhatsApp
- DIY mix-and-match builder (uses `bundle_components`)
- Reviews, loyalty

---

## 16. Verification strategy

- **Unit (Vitest)**: pricing engine, coupon rules, state-machine transitions, signature verification (payment and webhook secrets kept distinct), order-ref generator, money formatting, vibe cycle logic, copy dictionaries completeness.
- **Integration (Vitest + disposable Postgres, via Supabase CLI local or Docker)**:
  - concurrent reservations on the last unit
  - reservation expiry math
  - `finalizePaidOrder` idempotency and duplicate refund
  - late capture
  - webhook dedupe
  - refund partial/full bookkeeping
  - inventory ledger sums = `on_hand`
  - RBAC: fulfilment user is denied catalogue/pricing actions at the Server Action level
- **E2E (Playwright, against preview)** — spec §12 mapped one-to-one:
  - browse collection → PDP
  - cart maths after add, change and remove
  - out-of-stock blocked
  - invalid or expired coupon message
  - checkout validation and payable amount shown
  - Razorpay test-mode success / failure / dismiss (test cards, `success@razorpay` and `failure@razorpay` UPI)
  - confirmation details
  - admin edits product, adjusts stock, fulfils, cancels and refunds
  - policy links visible pre-purchase
  - unauthorised `/admin` access blocked
  - hand cycles in order and wraps (mouse, touch emulation, keyboard)
  - persistence across pages and reloads
  - shared `?vibe=gothic` URL opens Gothic
  - theme never removes products from search, collections or cart
  - reduced-motion hero is static and the Shop button is always visible
- **Visual + a11y**: screenshots per page × vibe × viewport; axe in every vibe; contrast script in CI.
- **Performance**: Lighthouse CI on home, PDP, collection and checkout with the §13 budgets; switch-timing assertion < 400 ms.
- **Manual**: real-device pass on mid-range Android Chrome and iPhone Safari; slow-network throttling; screen reader pass (VoiceOver, TalkBack) on the hand button, checkout and hero.

---

## 17. Owner inputs (blocking items, with the phase that needs them) — tracked in `docs/OWNER-INPUTS.md`

| Needed by | Input |
|---|---|
| Phase 2 | Logo files, brand colours/fonts (or approval of §8.2 proposals), hand-icon direction, legal entity name/address, support email/phone, grievance officer, policy drafts (or approval of templates for legal review), **Razorpay KYC docs** (PAN, bank, business proof) |
| Phase 3 | Real product list: names, SKUs, prices, MRP, stock, vibes, types, variants, descriptions, net qty, origin, manufacturer, HSN + GST rates (from CA), **"Hippers" definition** |
| Phase 3–7 | Product photography (consistent ratio) + **transparent cutouts** (same angle, lighting, ≥1200 px) |
| Phase 4 | Shipping fee, free threshold, serviceable regions, COD on/off, COD fee and limit, reservation TTL, coupon list |
| Phase 5 | Cancellation window, return/damage policy, refund timelines, notification events; WhatsApp provider (optional) |
| Phase 8 | Domain and DNS access, final legal review of policies, GA4 yes/no, launch date, sign-off |

---

## 18. Running costs (indicative; verify at signup)

- Vercel Pro ~$20/mo
- Supabase Pro ~$25/mo
- Resend free tier (3k emails/mo), then ~$20/mo
- Sentry free tier; domain ~₹1k/yr
- **Razorpay ~2% + 18% GST per transaction** (no setup fee)
- WhatsApp (later): ~₹0.12–0.15 per utility message + provider fee
- Shiprocket (later): per-shipment rates

Fixed total ≈ **$45–65/mo** plus transaction fees. No Shopify-style platform surcharge.

---

## 19. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Brand assets and cutouts arrive late, blocking the hero and theme look | Placeholder cutouts + token proposals let the build proceed. The launch gate blocks placeholders. The hero degrades to the poster |
| Razorpay activation delay | Staging with policies live in Phase 2; test mode covers all development |
| Payment edge cases (UPI pending, dropped callbacks, duplicates) | Verify + webhook + reconcile cron, idempotent finalize, duplicate auto-refund, integration tests for each ordering |
| Overselling under concurrency | Row locks with ordered acquisition, reservation TTL, availability computed from unexpired reservations, concurrency test |
| Theme switch over 400 ms on slow devices | All vibe content pre-rendered, next-vibe preload, font wait capped at 120 ms, timing test in CI |
| Gothic/Funky contrast failures | Token-pair contrast CI + axe per vibe |
| Hero hurting mobile performance | Poster-first, conditional lazy chunk, transform-only animation, Lighthouse budget gate |
| GST/legal uncertainty | All rates and policies are owner settings; the invoice supports both formats; legal review is a launch gate |
| Themed copy drifting into dark patterns | Neutral fixed copy for checkout and legal; review checklist |

---

## Sources (research, Oct 2026)
- Razorpay payment/webhook practice: https://razorpay.com/docs/payments/payment-gateway/web-integration/custom/best-practices/ · https://razorpay.com/docs/webhooks/best-practices.md · https://hookdeck.com/webhooks/platforms/guide-to-razorpay-webhooks-features-and-best-practices · https://dev.to/eventdock/how-to-verify-razorpay-webhook-signatures-and-why-it-is-not-the-payment-signature-1pei
- Gateway comparison: https://www.paritydeals.com/blog/best-payment-gateways-india-2026/ · https://www.investingpro.in/articles/best-payment-gateway-for-small-business-in-india-2026-razorpay-vs-cashfree-vs-payu
- Shopify India fees: https://razorpay.com/blog/razorpay-shopify-payment-gateway-pricing-explained/ · https://www.zenind.com/help/post/which-shopify-payment-gateways-can-indian-sellers-use-in-2026-
- Medusa Razorpay plugins: https://github.com/SGFGOV/medusa-payment-plugins · Payload ecommerce (beta): https://payloadcms.com/docs/v3/ecommerce/overview.md
- E-Commerce Rules 2020: https://www.indialaw.in/blog/consumer-protection-e-commerce-rules/ · https://khaitanco.com/thought-leaderships/Stricter-Regulations-on-E-Commerce-The-Consumer-Protection-E-Commerce-Rules-2020
- DPDP Rules 2025: https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified · https://www.hoganlovells.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force-
- Legal Metrology e-commerce: https://ssrana.in/corporate-laws/legal-metrology-and-packaging/ · https://www.india-briefing.com/news/consumer-protection-india-lm-rules-now-apply-e-commerce-notified-medical-devices-16587.html
- GST rate conflict (7117 / Ch. 48–49): https://www.registerkaro.in/hsn/gst-rate-hsn-code-7117 · https://tallysolutions.com/gst/jewellery-hsn-code-gst-rate-classification-invoicing-guide-for-businesses/ · https://www.ey.com/content/dam/ey-unified-site/ey-com/en-in/alerts-hub/2025/09/gst-council-announces-major-rate-rationalization-and-trade-facilitation-measures.pdf
- Shiprocket API: https://apidocs.shiprocket.in/view/metadata/SzYW1zB2 · https://support.shiprocket.in/support/solutions/articles/43000337456-shiprocket-api-document-helpsheet
- WhatsApp pricing India: https://m.aisensy.com/blog/whatsapp-pricing-update-october-2026/ · https://developers.facebook.com/docs/whatsapp/pricing
- GSAP free licence: https://webflow.com/blog/gsap-becomes-free · https://gsap.com/community/standard-license/
- Next.js 16: https://nextjs.org/blog/next-16 · View Transitions baseline: https://web.dev/blog/web-platform-10-2025
