# IfOnli content (policies and FAQ)

Legal and help content for the storefront. It is not legal advice: have a lawyer review it.

No business values are written into these files. Every fee, threshold, timeline, name, address and phone number is a **template token** that the site fills in from admin settings (`settings` table, plan section 14) when the page is rendered.

## Files and routes

| File | Route | Notes |
|---|---|---|
| `policies/shipping.md` | `/policies/shipping` | |
| `policies/cancellation.md` | `/policies/cancellation` | |
| `policies/returns-refunds.md` | `/policies/returns-refunds` | Both `return_policy_type` branches in one file |
| `policies/privacy.md` | `/policies/privacy` | DPDP Act 2023 aligned notice |
| `policies/terms.md` | `/policies/terms` | Terms and Conditions. Linked from the footer, the policies index and the checkout acknowledgement |
| `policies/seller-information.md` | `/policies/seller-information` | NEW route: not in plan section 10 yet. Link it from the footer |
| `faq.json` | `/help` (FAQ accordion) and admin FAQ seed | Seeds the `faqs` table. Answers use the same template renderer |

Each policy file begins with YAML front matter: `title`, `slug`, `version`, `status`, `lastReviewed`. The `slug` is the last part of the route. Seed these into `policies` / `policy_versions` (`body_md` = the body after the front matter). A policy whose `status` starts with `DRAFT` is seeded unpublished and the renderer refuses to publish it; the policies here use `status: "Published"` with a `lastReviewed` date.

### `faq.json` schema

An array of objects:

```
{ "category": "delivery" | "payment" | "product" | "orders",
  "question": string,
  "answerMd": string (Markdown + tokens),
  "position": integer, starting at 1 within each category }
```

## Seeding and rendering (implemented)

Load the files into the database (idempotent; safe to re-run):

```
pnpm exec tsx --conditions=react-server scripts/seed-content.ts [--force]
```

- Policies go into `policies` and `policy_versions`. `published` stays `false` while `status` starts with `DRAFT`. The integer `version` column holds the major number of the front-matter `version` (`0.1-draft` becomes `1`; the label itself is not stored). `lastReviewed` becomes `effective_at`.
- Re-running refreshes policies that are still unpublished from the files, and never touches a published policy or an existing FAQ (owner edits in the admin survive). `--force` overwrites both.
- To publish policies on an already-configured database without touching settings or anything else: `pnpm exec tsx --conditions=react-server scripts/store-values/apply-settings-content.ts --policy=terms [--allow-remote]` (comma list or repeated flag for several). Only the named policies are created (from their file, if missing), saved and published, and checked.
- Run `pnpm db:seed` first (or after pulling) so the new `policy.*` settings rows exist.
- The renderer is `src/server/content/render-template.ts`, Markdown conversion is `src/server/content/markdown.ts`, and the publishing rule is `src/server/content/publish.ts`.
- In production a policy is shown only when it is published AND every token resolved to a real value; otherwise `/policies/<slug>` shows a neutral "being finalised" notice (noindex). A FAQ answer with an unresolved or placeholder token is left out of `/help`. In development (or a build with `NEXT_PUBLIC_ENABLE_DEV_PAGES=1`) the same pages render with a DRAFT banner and highlighted markers.
- A token is a placeholder when its setting is flagged `is_placeholder` and is required for launch (the three return-policy copy keys only count once `return_policy_type` is not `no_returns`), or when its text starts with `PLACEHOLDER`.
- `delivery_estimates_by_zone` stores `{minDays, maxDays}` per zone, so `{{settings.delivery_estimates_by_zone.metro_region}}` prints as `2 to 4 days`. Until the owner sets a zone, the token is unresolved.

## Token syntax

The renderer is deliberately tiny. It runs on the Markdown source **before** the Markdown is converted to HTML. Values are inserted as plain text (HTML-escaped), except values marked "md string", which are inserted as Markdown source.

### Variables

`{{settings.<dot.path>}}`

- The path must start with `settings.`. Dots walk into objects (`settings.default_manufacturer.name`).
- Spaces inside the braces are allowed but not used in these files.
- Rendering by value type:
  - **string / number**: printed as is.
  - **money** (paise stored in the database): printed as rupees with the rupee sign and Indian grouping, for example `₹1,299`. Content therefore never writes a rupee sign before the token. Money keys: `flat_fee`, `free_threshold`, `cod_fee`, `cod_max_order_value`.
  - **array**: items joined with `, `. For `cancellable_statuses`, each item should be shown with its customer-facing label rather than the raw fulfilment status (for example the label for `unfulfilled`), so the renderer should map it through the same label map the order page uses.
  - **markdown string** (marked "md" below): inserted as Markdown source, so it may contain lists and links.
- A token that cannot be resolved, or whose value is still `PLACEHOLDER`, renders as a visible marker in admin preview. In production, the page must **not publish** while any unresolved or placeholder token remains (this follows the launch gate in plan section 14).

### Conditionals

```
{{#if <expr>}}
  ...shown when true...
{{else}}
  ...shown when false (optional)...
{{/if}}
```

`<expr>` is one of:

- `settings.<path>`: **truthiness**. False for missing, `null`, `false`, `0`, empty string, empty array and empty object. Everything else is true.
- `settings.<path> == "text"`: string equality.
- `settings.<path> != "text"`: string inequality.

Rules:

- Only `==` and `!=` against a **double-quoted string**. No `&&`, `||`, `!`, numbers or function calls.
- `{{else}}` is optional. There is no `else if`.
- Blocks **do not nest**. Content in these files never nests them.
- Tags may sit on their own line or inline. When a tag is alone on its line, the whole line (including its newline) is removed from the output.
- Variables may appear inside a conditional block.

### Example

```
{{#if settings.return_policy_type == "no_returns"}}
We do not accept returns for change of mind.
{{else}}
You can return items within {{settings.returns_window_days}} days.
{{/if}}
```

## Tokens used

Every token below appears in `content/**`. "Existing" means the key is in plan section 14. "NEW" means it does not exist yet and must be added to the settings schema (all NEW keys live under `policy.` and are required before publishing the pages that use them, unless noted).

### Store and legal (existing)

| Token | Type |
|---|---|
| `settings.legal_name` | string |
| `settings.brand_name` | string |
| `settings.registered_address` | string |
| `settings.state` | string |
| `settings.gstin` | string, optional (used in a conditional) |
| `settings.support_email` | string |
| `settings.support_phone` | string |
| `settings.support_hours` | string |
| `settings.response_time` | string |
| `settings.default_manufacturer.name` | string |
| `settings.default_manufacturer.address` | string |
| `settings.default_country_of_origin` | string |

### Shipping and COD (existing)

| Token | Type |
|---|---|
| `settings.serviceability_mode` | `all_india` / `allowlist` / `denylist` (compared in a conditional) |
| `settings.flat_fee` | money |
| `settings.free_threshold` | money |
| `settings.zone_overrides` | object, used for truthiness only |
| `settings.processing_days` | number or string |
| `settings.delivery_estimates_by_zone.metro_region` | string. Sub-path of an existing key. Zone ids come from `data/reference/zones.json` (placeholder grouping) |
| `settings.delivery_estimates_by_zone.rest_of_india` | string |
| `settings.delivery_estimates_by_zone.north_east` | string |
| `settings.delivery_estimates_by_zone.jk_ladakh` | string |
| `settings.delivery_estimates_by_zone.islands` | string |
| `settings.delay_message` | string, optional (used in a conditional) |
| `settings.cod_enabled` | boolean |
| `settings.cod_fee` | money |
| `settings.cod_max_order_value` | money |

### Inventory (existing)

| Token | Type |
|---|---|
| `settings.max_qty_per_line` | number |
| `settings.reservation_ttl_minutes` | number |

### Cancellation and returns (existing)

| Token | Type |
|---|---|
| `settings.cancellable_statuses` | array of fulfilment statuses |
| `settings.return_policy_type` | `no_returns` / `returns_window` (compared in a conditional) |
| `settings.returns_window_days` | number |
| `settings.damaged_claim_window_hours` | number |

### Analytics (existing)

| Token | Type |
|---|---|
| `settings.ga4_measurement_id` | string, optional (used in a conditional) |

### NEW keys (add to plan section 14 and the settings schema)

| Token | Suggested type | Used in | Meaning |
|---|---|---|---|
| `settings.policy.jurisdiction_city` | string | terms | City whose courts have jurisdiction |
| `settings.policy.processors` | md string | privacy | Names of the actual service providers (payment, courier, email/WhatsApp, hosting, analytics) |
| `settings.policy.materials_note` | md string | FAQ | Generic materials statement |
| `settings.policy.handmade_note` | string, optional | terms | Handmade/variation notice, if any |
| `settings.policy.working_days` | string | shipping | Which days count as working days, for example the days of the week |
| `settings.policy.courier_partners` | string | shipping | Courier partner name(s) |
| `settings.policy.delivery_attempts` | number | shipping, FAQ | Delivery attempts before RTO |
| `settings.policy.rto_handling` | md string | shipping | What happens after RTO (reship, refund, fees) |
| `settings.policy.refund_initiation_days` | number | cancellation, returns, FAQ | Working days we take to start a refund after approval or cancellation |
| `settings.policy.refund_bank_days` | string | cancellation, returns, FAQ | Time banks/wallets usually take to show a refund |
| `settings.policy.cod_refund_days` | number | returns, FAQ | Working days to send a COD refund after receiving UPI/bank details |
| `settings.policy.replacement_days` | string | returns | Time to dispatch a replacement |
| `settings.policy.return_conditions` | md string | returns | Conditions for returns (only when returns are enabled) |
| `settings.policy.non_returnable_items` | md string | returns | Non-returnable categories (only when returns are enabled) |
| `settings.policy.return_shipping_rule` | md string | returns | Who arranges and pays return shipping (only when returns are enabled) |
| `settings.policy.shipping_fee_refund_rule` | md string | returns | Whether shipping and COD fees are refunded in partial refunds |
| `settings.policy.retention_order_records` | string | privacy | Retention period for order and invoice records |
| `settings.policy.retention_period` | string | privacy | Retention period for other data |

Required-ness: `return_conditions`, `non_returnable_items` and `return_shipping_rule` are required only when `return_policy_type != "no_returns"`. `handmade_note` is optional. All others are required.

## Fixed (non-token) statements

A few statements are written as fixed text because they come from law or from the plan, not from business choice. Review them with the lawyer:

- National Consumer Helpline 1915 / +91 8800001915, consumerhelpline.gov.in, and e-Jagriti (e-jagriti.gov.in).
- Prices include all taxes; one coupon per order; guest checkout; email one-time-code sign-in; guest wishlist stored on the device.
- Customer age: 18 and over.

## Checking the content

Every `{{...}}` token in `content/**` (other than this README) must appear in the lists above. A quick check:

```
grep -rhoE '\{\{[^}]+\}\}' content --include='*.md' --include='*.json' --exclude=README.md | sort -u
```
