# Test report

What test suites exist, how to run each, what was observed in the Phase 8 QA pass, and how they cover the verification strategy (plan section 16) and the acceptance checks (specification section 12).

Environment of the observed runs: Linux x86-64, Node 22, Postgres 16, Next.js 16.4.3, Playwright 1.64.1 driving **Chrome for Testing 153.0.8010.12** (Chromium only: no WebKit or Firefox in this environment), seeded dev database (`pnpm db:seed`, `db:import-reference`, `db:seed-products`, `db:seed-content`). Browser e2e ran against `next dev` (the payment mock exists only outside production); the visual suite ran against a production build.

## 1. Suites at a glance

| Suite | Where | Count | How to run | Observed |
| --- | --- | --- | --- | --- |
| Unit (Vitest) | `tests/unit` | 741 tests, 48 files | `pnpm test` | 741 passed |
| Integration (Vitest + disposable Postgres) | `tests/integration` | 573 tests, 47 files | `pnpm test:integration` (`IFONLI_TEST_DB=name` to run beside other agents) | 573 passed. One unhandled rejection after the run when the whole suite runs under load; `admin-auth.test.ts` passes alone (KNOWN-ISSUES P-4) |
| End-to-end and accessibility (Playwright) | `tests/e2e` | 246 tests on the desktop project, 17 files | `E2E_BASE_URL=http://localhost:3108 pnpm e2e <file> --project=chromium-desktop` | see section 2 |
| Visual regression (Playwright) | `tests/visual` | 392 screenshots (375 storefront, 17 admin) | `E2E_VISUAL=1 E2E_BASE_URL=... pnpm visual` | 392 passed on the comparison run right after generation (section 3) |
| Contrast | `scripts/contrast-check.ts`, `tests/unit/vibe-contrast.test.ts` | every declared token pair in 5 vibes | `pnpm contrast` | all pairs pass (part of the unit run) |
| Types and lint | | | `pnpm typecheck`, `pnpm lint` | both clean |

Fixtures: `tests/support` holds the shared helpers (database connection, commerce settings, deterministic orders, a signed customer session, admin creation with two-factor enrolment, the axe wrapper). Everything the specs create is namespaced (`qa-` emails, `IFO-2610-QA*` order references, `qa-admin-*` staff) and removed again, and every setting, pincode or stock value they change is restored.

### Running the e2e specs

The specs that place orders or use the admin write to shared rows, so run **one spec file at a time and one project at a time** (never two such files in parallel; two parallel runs of `checkout` and `account` showed spurious failures in this pass for exactly that reason).

```bash
pnpm db:migrate && pnpm db:seed && pnpm db:import-reference && pnpm db:seed-products && pnpm db:seed-content
NEXT_PUBLIC_ENABLE_DEV_PAGES=1 PORT=3108 pnpm exec next dev -p 3108
E2E_BASE_URL=http://localhost:3108 pnpm e2e tests/e2e/golden-path.spec.ts --project=chromium-desktop
```

The specs read `DATABASE_URL`/`DIRECT_URL` and `BETTER_AUTH_SECRET` from `.env.local`. Admin specs that enrol two-factor use `E2E_ADMIN_FLOW=1` (the QA specs in this pass do it unconditionally; they create their own staff accounts).

## 2. End-to-end and accessibility specs

| Spec | Covers | Tests |
| --- | --- | --- |
| `smoke` | home responds | 1 |
| `vibe` | hand button cycle and wrap (mouse, touch, keyboard), persistence, shared `?vibe=` URL, reduced motion, 400 ms switch budget, font requests, scopes, no horizontal overflow | 11 |
| `storefront` | home, collections, filters and sorts, search (typo, no results), header keyboard, axe on the main pages in every vibe | 33 |
| `pdp-cart` | product page, variants, stock, delivery estimate, add to cart and drawer, cart maths, coupon messages, wishlist, axe | 17 |
| `checkout` | checkout validation, COD rules, prepaid mock success, failure and retry, order page, tracking, axe in every vibe | 22 |
| `account` | email-code login, profile and addresses, checkout prefill, guest order to account, wishlist sync, data export and deletion | 8 |
| `content` | policy pages, footer links, help page, FAQ accordion, contact form, axe | 21 |
| `hero` | animated hero: progressive enhancement, controls, 12 sampled frames with the Shop button visible, flash-rate guard, reduced motion, axe | 35 |
| `analytics` | first-party events, consent banner and optional GA4, reports | 6 |
| `admin`, `admin-content`, `admin-support` | admin sign-in with two-factor, product create/edit with images, settings, policy publish gating, banners, FAQ, users, audit, launch checklist, support inbox and cases (refund, replacement, reject) | 6, 9, 8 |
| `styleguide` | UI primitives: dialogs, drawers, toasts, steppers, 44 px targets, axe | 13 |
| **`a11y`** (new) | WCAG 2.2 AA axe scan, every impact level, 14 public page types in all 5 vibes, product, cart, checkout and order page in all 5 vibes, cart drawer in 5 vibes, search sheet, mobile menu, cancel and report dialogs, address dialog, account pages in 5 vibes, 17 admin pages, admin order detail, policy editor, admin sign-in | 15 |
| **`keyboard`** (new) | skip link, Tab sweep with a visible focus indicator on every stop (home in 5 vibes, product, checkout, account pages, track, help, policy, cart, search), search sheet and cart drawer focus trap and return, checkout order and error focus, cancel / report / address dialogs trap and return | 23 |
| **`responsive`** (new) | 390 px, 5 vibes: no horizontal scroll, tap targets at least 44 px on 14 public page types, product, cart, checkout, order and 5 account pages; sticky add-to-cart bar compact, on screen and never covering the end of the page; admin pages without sideways scroll | 13 |
| **`golden-path`** (new) | browse to product to cart to COD checkout to order page to track; prepaid through the dev mock then customer cancel and refund; admin packs and ships with an AWB and the customer sees Shipped; admin cancels a paid order, refund and e-mail | 4 |

Observed in the final pass (desktop Chromium, against `next dev`): see the table in section 6 for the last full run of the four new specs.

Defects the new specs found and that were fixed are listed in KNOWN-ISSUES ("Fixed during this pass") and in the commit log.

## 3. Visual regression

392 screenshots: 25 storefront page types x 5 vibes x 3 widths (375) plus 17 admin pages at 1440. Deterministic by construction (reduced motion, frozen clock, seeded data, fixed orders, masked live regions). The suite was verified locally with Chrome for Testing 153, but no baselines are committed yet: they must come from CI's browser. See [tests/visual/README.md](../tests/visual/README.md) for how to run and when to regenerate (CI uses a different Chromium build, so regenerate there once).

## 4. Coverage of plan section 16

| Item | Status | Where |
| --- | --- | --- |
| Unit: pricing, coupons, state machines, signatures (payment and webhook secrets distinct), order refs, money, vibe cycle, copy dictionaries | Covered | `tests/unit/domain`, `cart-math`, `money`, `payments-helpers`, `vibe-config`, `vibe-copy` |
| Integration: concurrent reservations on the last unit, reservation expiry, `finalizePaidOrder` idempotency and duplicate refund, late capture, webhook dedupe, refund bookkeeping, ledger sums, RBAC denial at the action level | Covered | `inventory`, `commerce-checkout`, `payments-finalize`, `payments-reconcile`, `payments-webhook`, `payments-refunds`, `permissions` (unit), `admin-*` |
| E2E against a preview | Partially: run against a local dev server, not a deployed preview | `tests/e2e` |
| Razorpay test-mode success / failure / dismiss with real test cards and UPI ids | Not covered (no Razorpay keys here). The dev mock covers success, failure and dismiss; signature, webhook and refund handling are covered by integration tests | `checkout.spec`, `payments-*` |
| Visual + a11y: screenshots per page x vibe x viewport, axe in every vibe, contrast script in CI | Covered | `tests/visual`, `a11y.spec`, `pnpm contrast` |
| Performance: Lighthouse CI on home, PDP, collection and checkout; switch under 400 ms | Partially: the 400 ms switch is asserted (`vibe.spec` h); Lighthouse budgets are not measured | KNOWN-ISSUES V-3 |
| Manual: real devices, slow network, screen reader | Not covered | KNOWN-ISSUES V-1, V-2 |

## 5. Coverage of the acceptance checks (specification section 12)

| # | Check | Status | Spec / test |
| --- | --- | --- | --- |
| 1 | Customer browses a collection and opens a product page | Covered | `golden-path`, `storefront`, `pdp-cart` |
| 2 | Cart item, quantity, price and subtotal are correct; changes and removals recalculate | Covered | `pdp-cart` (totals, quantity, remove), unit `cart-math`, integration `commerce-cart` |
| 3 | Out-of-stock items cannot be bought; concurrent purchases follow stock rules | Covered | `pdp-cart` (sold out), integration `inventory`, `commerce-checkout` (last unit) |
| 4 | Invalid or expired coupons are rejected with a clear message | Covered | `pdp-cart` (coupon messages), integration `commerce-coupons` |
| 5 | Checkout validates required fields and shows the full payable amount | Covered | `checkout` (validation, review amounts, button states the total) |
| 6 | Successful payment creates or updates an order with a verifiable status | Partially | `checkout` and `golden-path` with the dev mock; integration `payments-verify`, `payments-finalize`. Not run against Razorpay |
| 7 | Failed, cancelled, pending or duplicate payments never mark an order paid or charge twice | Covered (service level) | integration `payments-webhook`, `payments-finalize`, `payments-reconcile`; e2e failure and dismiss in `checkout` |
| 8 | Confirmation and notifications show the correct reference and summary | Partially | `checkout` (order page amounts and ref), unit `notify-templates`, integration `notify-sender`. No real email delivery tested |
| 9 | Admin edits a product, updates stock, views orders, updates fulfilment status | Covered | `admin` (create/edit product), `golden-path` (pack and ship), integration `admin-inventory`, `admin-orders`. Stock adjustment through the UI is covered at service level only |
| 10 | Policy links work before purchase; full journey works on agreed mobile and desktop browsers | Partially | `content` (links), `checkout`, `responsive` (390 px), `golden-path` (desktop). Chromium only; no Safari or real devices |
| 11 | Unauthorised users cannot reach admin functions | Covered | `admin` gating, integration `admin-auth`, unit `permissions` |
| 12 | Hand button cycles through all themes in order and wraps (mouse, touch, keyboard) | Covered | `vibe` (a), (e), (f) |
| 13 | Theme persists across pages and return visits; shared theme URL opens in that theme | Covered | `vibe` (b), (c), (d) |
| 14 | Switching theme never removes products from search, collections, cart or checkout | Covered | `storefront` ("the theme never removes products"), `a11y` (cart and checkout in all vibes) |
| 15 | Every theme passes contrast checks on home, product, cart and checkout | Covered | `pnpm contrast` and unit `vibe-contrast` (token pairs), `a11y` (axe colour contrast on those pages in all 5 vibes) |
| 16 | Hero shows a static frame under reduced motion; Shop button stays visible; mobile load meets target | Partially | `hero` (reduced motion poster, 12 sampled frames); mobile load target not measured (KNOWN-ISSUES V-3) |
| 17 | Admin cancels or refunds an order and the status and customer notification update | Covered | `golden-path` (admin cancel of a paid order: refund, status, e-mail queued), `admin-support` (refund from a case), integration `admin-orders`, `payments-refunds` |

Open acceptance items (6, 8, 10, 16) need Razorpay test mode, a real email provider, real devices and Lighthouse on a deployment.

## 6. Last full run of the QA specs

Desktop Chromium against `next dev`, one worker, `a11y` + `responsive` + `keyboard` + `golden-path` in one command (55 tests, 12.6 minutes):

- 53 passed, 2 failed. Both failures were real findings and were fixed afterwards: an audit-log "N lines" disclosure whose accessible name did not contain its visible text (axe `label-content-name-mismatch`, 17 admin pages scan), and the keyboard product-page test that assumed the first variant could be bought (the first Heart charm variant is seeded as sold out; the test now picks Lilac with the keyboard). Both tests were re-run after the fixes and passed.
- The admin accessibility scan was first run with an exclusion for the admin account menu, whose name mismatch was fixed in the customers workstream; after merging, the scan runs with nothing excluded.
- Existing specs re-run after the fixes (desktop Chromium): `checkout` + `account` (26 passed, 4 skipped, run with one worker), `pdp-cart`, `content` and `storefront` (all passed when not run in parallel with `checkout`/`account`), `styleguide` (13 passed after removing its duplicate toast provider).
- Visual: baselines generated against a production build, then re-compared in a second full run with no update: 392 passed, 34 skipped (admin screenshots skip at 390 and 768), 0 failed, 12.2 minutes.

First-run history (for the record): the `a11y` run found the 404 numeral contrast (1.2:1), admin faint text contrast (3.4:1 and 4.3:1) and the account-menu name; `responsive` found about 25 link and control targets under 44 px (breadcrumbs, policy contents list, draft-banner disclosure, product type link, cart line names, "Edit your cart", footer vibe links); `keyboard` found no focus return for the address dialog and the cart drawer, and a skip-link target that could not take focus.
