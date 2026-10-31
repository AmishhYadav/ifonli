# Known issues

An honest list as of the Phase 8 QA pass. Severity: **Critical** (cannot launch), **High** (must be fixed or accepted in writing before launch, spec section 12), **Medium** (fix soon after launch), **Low** (cosmetic or rare). "Owner" means it needs a business or legal decision, not code.

## Launch blockers (not code)

| # | Severity | Owner | Issue |
| --- | --- | --- | --- |
| K-1 | High | Owner + lawyer | **Policies are drafts.** The seven policy pages (`content/policies/*.md`) are templates, not legal advice, and are unpublished. Production hides a policy until it is published and every value in it is filled in. A lawyer must review them (especially privacy/DPDP, returns, grievance and seller information) before the owner publishes. |
| K-2 | High | Owner | **Placeholders everywhere.** Products (SKUs `PH-`), prices, stock, images, cutouts, support and grievance details, shipping/COD values, and the GST rate are made-up starting values. The launch checklist (Admin > Settings) blocks real orders until they are replaced. |
| K-3 | High | Owner | **Live payments are untested.** Prepaid flows are verified with an in-memory mock and in integration tests of signature, webhook and refund handling. They have not been run against Razorpay (test or live). Before launch: Razorpay test-mode run with the test card and `success@razorpay` / `failure@razorpay` UPI ids, the strict CSP checked with the real checkout, auto-capture confirmed ON, the live webhook secret set, and the Phase 8 live-mode smoke test (a real Rs 1 product by UPI and card, refunded; a COD order placed and cancelled). |
| K-4 | High | Owner | **Email is untested against a real provider.** Order, refund and support emails go through Resend; locally they are written to `.dev-mail/`. Domain authentication (SPF, DKIM) and a real send are still to do. |
| K-5 | Medium | Owner | **Tax questions for the CA.** Whether shipping and the COD fee follow the "dominant line rate" rule (setting `shipping_tax_rule`); the GST state code used for the merged Dadra and Nagar Haveli and Daman and Diu UT (set to 26; the GST portal still lists 25 and 26); whether the shop issues tax invoices or bills of supply (GSTIN). Invoices look right but have not been reviewed by an accountant. |
| K-6 | Medium | Owner | **Pincode directory is a 2019 snapshot** (plus 40 newer pincodes). Newer pincodes show as "unknown" at checkout. Re-import a fresh data.gov.in extract before launch. Delivery zones are a placeholder grouping. |
| K-7 | Medium | Owner | **"A real person reads every report"** (the report-a-problem dialog) and the support response time are promises. Make sure the team can keep them, or reword. |

## Verification still to do

| # | Severity | Issue |
| --- | --- | --- |
| V-1 | Medium | **Real-device pass not done**: mid-range Android Chrome and iPhone Safari, slow-network throttling (plan section 16). All automated browser tests ran on Chromium only (this environment has no WebKit or Firefox). |
| V-2 | Medium | **Screen-reader pass not done** (VoiceOver, TalkBack) on the hand button, checkout and the hero. Automated checks (axe, keyboard sweeps) cannot replace it. |
| V-3 | Medium | **Lighthouse budgets not measured** on a production deployment (plan section 13: home and PDP 85, other pages 90; LCP 2.5 s; CLS 0.05; initial JS 150 KB gzip). The acceptance check "mobile load meets agreed target" is therefore open. |
| V-4 | Medium | **Backups and restore drill, Sentry, rate limits on the live host, security headers and CSP with live Razorpay** belong to the security and CI work and RUNBOOK; they have not been exercised on a live host. |
| V-5 | Low | **Visual baselines are browser-specific.** They were made with Chrome for Testing 153; Playwright 1.64.1 downloads Chromium 156, so CI must regenerate them once (`pnpm visual:update`, see `tests/visual/README.md`). |
| V-6 | Low | The e2e specs that place orders or use the admin mutate shared dev-database rows (settings, pincodes, stock) and restore them afterwards. They must run one project at a time and not in parallel with each other. |

## Product and code

| # | Severity | Issue |
| --- | --- | --- |
| P-1 | Low | **Animated hero tiles are small tap targets while moving** (about 33 px at 390 px wide). They are decorative, pausable (the Pause control and hover/focus pause), and the same products are reachable from the poster tiles and the featured grid, so the 44 px target rule is not enforced for them. Still, a tile that is tapped mid-motion can be missed. |
| P-2 | Low | **Admin account menu name.** The trigger's `aria-label` ("Account menu") did not contain its visible text (WCAG 2.5.3, flagged by axe on every admin page). Fixed in the orders/support branch (commit "fix account menu name"); the accessibility spec passes only once that branch is merged. |
| P-3 | Low | **Customers admin screen** shows "Coming soon" until the customers module is merged; its service, export and delete are built and tested. |
| P-4 | Low | **Intermittent unhandled rejection** (`APIError: Invalid email or password`) at the end of `tests/integration/admin-auth.test.ts` when the whole integration suite runs under load (573 tests pass; the file passes alone). The test that rejects a wrong password leaves a promise unawaited. No product impact. |
| P-5 | Low | **Dev console warning** "Encountered a script tag while rendering React component" appears in development (the inline vibe script). It does not appear to affect behaviour; check it is absent from the production console before launch. |
| P-6 | Low | **Shipping is manual.** Couriers and AWB numbers are typed in by staff; there is no live rate, label or tracking feed (Phase 9: Shiprocket). Tracking links are built from the AWB for common couriers. |
| P-7 | Low | **Product images from Supabase Storage** are allowed in `next.config.ts` only for the local Storage host. Add the production Supabase host before launch (owned by the security and CI work). |
| P-8 | Low | **Cart page shows no COD line.** The COD fee is shown as its own line at checkout, before the Place order button, as the copy checklist requires; the cart only gives a shipping estimate. Consider a one-line "COD adds a Rs X fee" note under the totals if COD is on. |
| P-10 | Low | **Default variant can be sold out.** The product page opens on the first variant; when that one is out of stock but others are available (seeded Heart charm: Pink sold out, Red and Lilac in stock) the page opens on a disabled "Sold out" button until the shopper picks another colour. Consider opening on the first purchasable variant. |
| P-9 | Low | The animated hero's colour and motion per vibe, the display fonts and the five looks are proposals awaiting owner and brand review (see HERO.md and OWNER-INPUTS.md). |

## Fixed during this pass

See the commit log; in short: focus is now returned to the opener when a state-driven dialog or drawer closes (address dialog, cart drawer); the skip link target is focusable; breadcrumb, policy contents, draft-banner, checkout and footer links reach 44 px; the 404 numeral and the admin "faint" text meet contrast; the styleguide no longer mounts a second toast region; the audit-log disclosure has an accessible name that contains its visible text; flattering or dare-style wording was removed from the Overthinking and Bold vibe strings.
