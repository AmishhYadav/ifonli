# Known issues

An honest list as of 2026-11-10. IfOnli is a **college project**: there has been no lawyer review and no CA or tax work, and neither is planned (tax is skipped). The real catalogue (26 products, `IFO-` SKUs, real photos) and the real store values (`content/store-values/`) are applied. The site is live on free tiers: Vercel Hobby (https://ifonli.vercel.app), Supabase free (`ifonli-staging`, used as production), Resend free, and cron-job.org for the four frequent crons. Severity: **Critical** (cannot launch), **High** (must be fixed or accepted in writing before real orders), **Medium** (fix soon after launch), **Low** (cosmetic or rare). "Owner" means it needs a business decision, not code.

## Launch blockers (not code)

| # | Severity | Owner | Issue |
| --- | --- | --- | --- |
| K-3 | High | Owner | **Live payments are untested, and the store is closed.** Razorpay live approval is pending. The launch gate keeps orders closed until the three Razorpay keys are set. Prepaid flows are verified with an in-memory mock and in integration tests of signature, webhook and refund handling; they have not been run against Razorpay (test or live). Before opening: a Razorpay test-mode run (test card, `success@razorpay` / `failure@razorpay` UPI ids), auto-capture confirmed ON, the webhook secret set, then switch `CSP_MODE` from report-only to `enforce` and re-run a payment under the strict CSP. A live-mode smoke test (a real Rs 1 order by UPI and card, refunded; a COD order placed and cancelled) comes last. |
| K-4 | High | Owner | **Customer emails do not arrive.** There is no domain yet, so mail goes out from Resend's free sender `onboarding@resend.dev`, which can only deliver to the address of the Resend account owner. Order, refund and support emails to anyone else are not delivered (the outbox keeps retrying and the rows end up failed). Needs a real domain and Resend domain authentication (SPF, DKIM), then `EMAIL_FROM` on that domain. The same domain replaces `ifonli.vercel.app` as the public URL. |
| K-6 | Medium | Owner | **Pincode directory is a 2019 snapshot** (plus 40 newer pincodes). Newer pincodes show as "unknown" at checkout. Re-import a fresh data.gov.in extract (`pnpm db:import-reference`; the admin Pincodes screen switches serviceable and COD for pincodes already in the directory, it cannot add new ones). Delivery zones are a placeholder grouping. |
| K-7 | Low | Owner | **"A real person reads every report"** (the report-a-problem dialog) and the 24-hour support response time are promises. Make sure the team can keep them, or reword. |

## Verification still to do

| # | Severity | Issue |
| --- | --- | --- |
| V-1 | Medium | **Real-device pass not done**: mid-range Android Chrome and iPhone Safari, slow-network throttling (plan section 16). All automated browser tests ran on Chromium only (this environment has no WebKit or Firefox). |
| V-2 | Medium | **Screen-reader pass not done** (VoiceOver, TalkBack) on the hand button, checkout and the hero. Automated checks (axe, keyboard sweeps) cannot replace it. |
| V-3 | Medium | **Lighthouse on production**: measured against the live deployment (budgets in plan section 13: home and PDP 85, other pages 90; LCP 2.5 s; CLS 0.05; initial JS 150 KB gzip); see Lighthouse section, 2026-11-10. |
| V-4 | Medium | **Backups and restore drill, rate limits on the live host, and the strict CSP with live Razorpay** have not been exercised on the live host. Sentry is not installed: the dependency-free error reporter (`src/lib/monitoring`) does nothing without `SENTRY_DSN`, so the only error trail is Vercel runtime logs. The Supabase free tier gives no managed backups. |
| V-5 | Low | **No visual baselines committed yet.** The suite passed locally on Chrome for Testing 153, but Playwright 1.64.1 downloads Chromium 156, so the first baselines must be generated on CI's browser (`pnpm visual:update`, see `tests/visual/README.md`), reviewed and committed. Until then `pnpm visual` has nothing to compare against. |
| V-6 | Low | The e2e specs that rewrite shared dev-database rows (commerce settings, test pincodes and stock, the qa- fixtures) queue on a Postgres advisory lock (`tests/support/fixture-lock.ts`), so they never overlap across workers; they still assume a dev database nobody else is changing at the same time. |

## Product and code

| # | Severity | Issue |
| --- | --- | --- |
| P-1 | Low | **Animated hero tiles are small tap targets while moving** (about 33 px at 390 px wide). They are decorative, pausable (the Pause control and hover/focus pause), and the same products are reachable from the poster tiles and the featured grid, so the 44 px target rule is not enforced for them. Still, a tile that is tapped mid-motion can be missed. |
| P-5 | Low | **Dev console warning** "Encountered a script tag while rendering React component" appears in `next dev` on a 404 from a dynamic page (for example `/products/no-such-product`, `/types/x`, `/vibes/x`). Cause: `notFound()` there makes Next send its error shell (`<html id="__next_error__">`) and the browser renders the not-found tree, root layout included, so React client-renders the inline `<script>` tags in `<head>` (the Zod jitless and vibe scripts). Those scripts must stay inline and blocking (no-flash vibe, CSP hash), and the real document already ran them, so nothing breaks. The warning is React development-only: a production build prints nothing (checked). |
| P-6 | Low | **Shipping is manual.** Couriers and AWB numbers are typed in by staff; there is no live rate, label or tracking feed. Tracking links are built from the AWB for common couriers. |
| P-8 | Low | **Cart page shows no COD line.** The COD fee is shown as its own line at checkout, before the Place order button, as the copy checklist requires; the cart only gives a shipping estimate. Consider a one-line "COD adds a Rs X fee" note under the totals if COD is on. |
| P-10 | Low | **Policy and store-value text still mentions retired or unrelated things.** `policy.processors` says Resend sends "sign-in codes" (customer sign-in is retired), `policy.jurisdiction_city` is Mumbai while the registered address is in Bengaluru, and `policy.retention_order_records` cites tax law although tax work is skipped. Edit in `content/store-values/settings.json` and re-apply (`pnpm db:store-values`) if the policies are shown to anyone who will read them closely. |

## Security and operations

| # | Severity | Issue |
| --- | --- | --- |
| S-3 | Low | **Staff password guessing is limited per email and IP, not by a stored lockout.** 8 attempts per 10 minutes per email can briefly lock a known staff address out of the sign-in form. Two-factor has Better Auth's own per-account lockout (10 failures, 15 minutes). |
| S-5 | Low | **Lighthouse is still not a CI gate** (home scored 0.57-0.77 on the CI runner against a 0.85 budget; a local mobile run on the production build after the perf pass gave home 0.89-0.92, product page 0.92-0.96, shop 0.91-0.97, cart 0.89-0.93). The remaining gap to the 2.5 s LCP budget is mostly the 120 KB framework floor plus the 1 MB home document. Reports are uploaded as the `lighthouse` artifact (`lhci-results/`). |

## Resolved (kept for the record)

- ~~K-1 Policies need legal review~~ Not doing: college project. The policy pages (`content/policies/`, filled from `content/store-values/settings.json`) are not legal advice.
- ~~K-2 Placeholders everywhere~~ Done: the real catalogue (26 products, `IFO-` SKUs, real photos) and store values are applied. The `PH-` placeholder catalogue is dev-only (`pnpm db:seed-products`).
- ~~K-5 Tax questions for the CA~~ Not doing: tax is skipped for this project (no GSTIN, no accountant review of invoices).
- ~~P-9 Hero, fonts and looks are proposals~~ Settled: four moods (Mochi, Chaos Cabinet, Unapologetic, After the Dark) with Nunito body and Fredoka, Rubik Glitch, Bungee Shade and Creepster display fonts.
- ~~S-2 A stranger can burn a sign-in code~~ No longer applies: customer email-OTP sign-in is retired (customers check out as guests and use a simple My Profile form). Hippers and coupons are retired too.
- Earlier QA pass fixes (focus return on dialogs and drawers, 44 px targets on breadcrumb, policy, checkout and footer links, contrast on the 404 numeral and admin faint text, the review-build order gate, `next dev` no longer logging Server Function arguments) are in the commit log.
