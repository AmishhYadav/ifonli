# Analytics, Reports and Insights (Phase 6)

First-party, anonymous event counting (FR-18), the Reports and Insights admin screens (FR-26) and the optional, consent-gated Google Analytics 4. Plan references: sections 3, 11, 12 and 15.

## Recording an event from the browser

```ts
import { track } from "@/features/analytics";

track("hero_tile_click", { productId, meta: { tile: "3", scene: "5" } }); // animated hero (phase 7)
track("hero_play");
track("hero_pause", { meta: { by: "user" } });
```

`track(event, props?)` batches events, sends them with `navigator.sendBeacon` (falling back to `fetch` with `keepalive`), never throws and does nothing on the server. `path` defaults to the current pathname (query and hash are never sent; `/orders/<ref>` and `/account/orders/<ref>` are masked) and `vibe` to the active vibe. For `vibe_switch` the `vibe` is the vibe switched TO.

`props`: `productId` (uuid), `vibe`, `path`, `value` (integer 0 to 1,000,000), `meta` (up to 8 keys, key `[A-Za-z][A-Za-z0-9_]{0,23}`, value string up to 100 characters, number or boolean). Do not put personal data in `meta`.

### Events

| Event | Sent by | `value` / `meta` |
|---|---|---|
| `page_view` | `AnalyticsProvider` (every client navigation) | |
| `product_impression` | impression observer: card at least 50% visible for 1 s, once per page view | `meta.pos` (position among the cards that are visible: the home page renders the sets of all four vibes and only one is shown) |
| `product_click` | delegated click on a product card link | `meta.pos` (same counting) |
| `pdp_view` | `PdpTracker` on the product page | |
| `pdp_scroll_depth` | `PdpTracker`: 25 / 50 / 75 / 100 % of `<main>`, each once | `value` = milestone |
| `add_to_cart` | `StockControls` (product page) | `value` = units the cart actually took (after stock and per-line caps; nothing is sent when 0 were added) |
| `remove_from_cart` | cart drawer and cart page (`useOptimisticCart`), after the server confirmed a remove or a lower quantity | `value` = units taken out |
| `view_cart`, `begin_checkout` | `AnalyticsProvider`, on `/cart` and `/checkout` | |
| `vibe_switch` | `AnalyticsProvider`, from the vibe store event (hand, "Wear this vibe", API; not restore or `?vibe=`) | `vibe` = target, `meta.from`, `meta.source` |
| `search` | `SearchTracker` on `/search` | `value` = result count (0 feeds "no results"), `meta.q` = normalised term (dropped if it looks like an e-mail or phone number) |
| `wishlist_add` | `WishlistHeart` | |
| `hero_play`, `hero_pause`, `hero_tile_click` | hero workstream (call `track`) | `meta.tile` |
| `add_shipping_info`, `add_payment_info` | `trackShippingInfo()` / `trackPaymentInfo(method)` from `src/features/analytics/checkout-events.ts`, to be called by the checkout form when it is submitted with valid details | `meta.method` = `razorpay` or `cod` (payment only) |
| `purchase`, `purchase_item`, `order_placed` | **server only**, inside the order transactions; the endpoint rejects them | see below |

Product cards carry `data-product-id` (set in `ProductCardView`), which is all the observer needs; any card that mounts later is picked up by a `MutationObserver`.

## Endpoint: `POST /api/events`

Body `{ sessionId, events: [...] }`, at most 20 events and 8 KB. Order of checks: foreign `Origin` (403), size (413), bots (silently ignored with 204), JSON and schema (400), rate limit 90 requests per minute per IP and 40 per minute per session (429 with `Retry-After`). The insert runs in `after()`, so the response is always an immediate 204. Events from `/admin` and `/api` paths are dropped. Code: `src/server/services/analytics/` (`ingest.ts`, `schema.ts`, `bots.ts`).

## Session id and what needs consent

- The session id is random (128 bits), kept in `sessionStorage` (per tab) and renewed after 30 idle minutes. It is mirrored into a **session cookie** `ifonli_sid` (no Max-Age, `SameSite=Lax`) only so the checkout can tie an order to its visit for the funnel. It identifies a visit, not a person.
- First-party counting is anonymous and aggregate, so it is **not** gated by consent (D-23). The privacy policy template discloses it (section 9, "Visit counter").
- **GA4 is optional**: nothing loads unless an id is configured (`NEXT_PUBLIC_GA4_ID`, falling back to the admin setting `ga4_measurement_id`) and, while the setting `consent_required` is on (default), the visitor allowed it. The Content-Security-Policy always allows the Google Tag Manager / Analytics origins (`src/lib/security/headers.ts`), not only when `NEXT_PUBLIC_GA4_ID` is set at build, because the admin setting is read at request time and the build cannot see it; the origins do nothing until gtag is loaded. The choice is stored in the `ifonli_consent` cookie (`granted` or `denied`, 180 days). The banner shows only when GA4 is configured and nothing was chosen; "Cookie settings" in the footer reopens it. Both answers have equal weight and neutral wording (no dark patterns). GA4 receives the mirrored event names (`view_item_list`, `select_item`, `view_item`, `add_to_cart`, `begin_checkout`, `search`, `add_to_wishlist`, ...) with product ids only; Google signals and ad personalisation are off.

## Purchases

`recordPurchase` (src/server/services/analytics/purchase.ts) writes one `purchase` event per order (`value` = order total in paise, `meta.orderId`) and one `purchase_item` per product (`value` = revenue of its lines in paise, `meta.qty`). It is called at COD placement (`createFromCart`) and when a prepaid payment is captured (`finalizePaidOrder`), inside the same transaction but in its own savepoint with its own try/catch, so an analytics failure never blocks an order. It is idempotent per order. `order_placed` remembers the visit's session id so a webhook-confirmed order still joins the funnel; orders with no known visit use the session key `order:<orderId>` (counted in sales, not in the funnel).

## Rollup and retention

`GET /api/cron/analytics-rollup` (hourly, `CRON_SECRET`): rebuilds `product_engagement_daily` for the last 3 India days (`?days=N`, 1 to 90, for a backfill), one day at a time (delete and insert in a transaction, so it can be re-run or overlap safely), then deletes raw events older than `event_retention_months` (default 13) in batches. Rollup rows are never deleted by retention; days past the retention horizon are not rebuilt. All days are Asia/Kolkata days.

## Reports and Insights (`/admin/reports`, `/admin/insights`)

Permissions `report:view` and `insight:view` (owner and admin; fulfilment has neither). Date ranges are India days in the URL (`from`, `to`, default last 30 days, at most a year); presets for 7, 30 and 90 days. Reports: sales by day or week, orders by status, top products, vibes and types, coupon performance, funnel; every card has an **Export CSV** link (`/admin/reports/export?report=sales|status|products|vibes|types|coupons|funnel`). Sales use the dashboard definition (confirmed or later, not cancelled or refunded; revenue is the order total). Insights: most viewed, most seen, scroll engagement, CTR and add-to-cart rate by product, vibe performance and switches, hero tile clicks, searches with no results, and rule-based "worth a look" flags (`insight-rules.ts`): high impressions with low CTR, high views with low add-to-cart rate, carts that do not convert. Rules compare each product with the catalogue rate and need a minimum sample (100 impressions, 30 views, 10 add to carts).

Charts are hand-rolled SVG (`role="img"` with a text summary) and every chart has a table alongside it.
