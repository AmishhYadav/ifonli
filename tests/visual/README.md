# Visual regression

Screenshots of every storefront page type in all four vibes at three widths, plus the main admin pages, compared pixel by pixel (`toHaveScreenshot`). A change that moves, recolours or restyles something fails the run and shows the diff.

| What | Coverage |
| --- | --- |
| Storefront | home (hero as its poster), shop, vibe collection, type collection, product, search with results, search with no results, cart empty, cart filled, checkout (filled form), order confirmation (COD, confirmed), order shipped, order cancelled and refunded, track, track result, help, a policy page, wishlist, account login, account overview, orders, order detail, addresses, profile, 404 |
| Vibes | cute, funky, bold, gothic (each page is opened with `?vibe=`) |
| Widths | `visual-390`, `visual-768`, `visual-1440` (one Playwright project each) |
| Admin | dashboard, orders, order detail, products, inventory, collections, discounts, support, content, FAQ, policies, settings, users, audit, reports, insights, sign-in, at 1440 only |

392 screenshots in total (375 storefront, 17 admin; about 75 MB). Baselines live in `tests/visual/__screenshots__/<project>/<page>-<vibe>.png`.

**No baselines are committed yet.** The suite was verified locally (392/392 generated, then a clean second run with 0 diffs), but those images came from the sandbox's older Chromium and would only fail on CI's browser, so they were not committed. Generate the first set on CI's browser as described below, review them, and commit them.

## Running it

It is off unless `E2E_VISUAL=1`, and it has its own config, so `pnpm e2e` never needs baselines.

```bash
# 1. A production build on a seeded database. NEXT_PUBLIC_ENABLE_DEV_PAGES=1 lets the policy drafts render
#    (they are drafts until the owner publishes them) and exposes the hero test hook.
pnpm db:migrate && pnpm db:seed && pnpm db:import-reference && pnpm db:seed-products && pnpm db:seed-content
NEXT_PUBLIC_ENABLE_DEV_PAGES=1 pnpm build
pnpm start -p 3108

# 2. Compare against the baselines
E2E_VISUAL=1 E2E_BASE_URL=http://localhost:3108 pnpm visual
# one page, or one width
E2E_VISUAL=1 E2E_BASE_URL=http://localhost:3108 pnpm visual -g "product" --project=visual-390
```

Use `BETTER_AUTH_SECRET` (the same value the server runs with) and `DATABASE_URL` in `.env.local`: the fixtures write a customer session and a few orders straight into the database and remove them afterwards. The dev database is fine; the fixtures refuse a hosted-looking URL.

Set `PW_CHROMIUM_PATH` to use a Chromium other than the one Playwright downloaded.

## What makes it deterministic

- `reducedMotion: reduce`: the hero is its static poster, the hand button swaps instantly, nothing animates. `animations: "disabled"` as well.
- The clock is frozen (`page.clock.setFixedTime`) at 31 Oct 2026 10:00 IST; timezone `Asia/Kolkata`, locale `en-IN`, light colour scheme.
- Seeded catalogue (placeholder SVG cutouts, no network images). Orders are inserted with fixed references, dates and a fixed guest token (`IFO-2610-QA2x`), so the order pages never change. Commerce settings (shipping fee, COD fee, GST) are set for the run and restored.
- Every lazy image is scrolled into view and fonts are awaited before a shot. Tall pages are cropped to the first 2,400 CSS px.
- Masked (painted over, box still compared): the delivery estimate and live stock line on the product page (they depend on today's date and on stock), anything with `data-visual-mask`, `<time>` elements, and on admin pages the table bodies, numbers and charts (live data). Everything else is compared.

## Which browser the baselines must come from

The suite was first verified on Linux x86-64 with Google Chrome for Testing 153 (Playwright's `chromium-1243`, through `PW_CHROMIUM_PATH`), Playwright 1.64.1, device scale factor 1.

Playwright 1.64.1 itself downloads Chromium 156 (revision 1248). Text anti-aliasing and font hinting differ slightly between builds, so on a machine with a different browser the first run can fail across many pages with tiny diffs. That is the browser, not the site. Regenerate the baselines **on the machine that will compare them** (CI), review the new images in the pull request, and commit them:

```bash
E2E_VISUAL=1 E2E_BASE_URL=http://localhost:3108 pnpm visual:update
```

Do this whenever the browser changes (Playwright upgrade, new CI image) and whenever a deliberate design change lands. Review the diff images before committing: a baseline update is where a regression can hide.

## Tolerances

`maxDiffPixelRatio: 0.002` (0.2 % of pixels) and a per-pixel colour `threshold` of 0.2: enough to absorb anti-aliasing noise, small enough that a moved button, changed colour or wrong font fails. Adjust in `playwright.visual.config.ts`.

## When a run fails

`test-results/visual/<test>/` holds the actual, expected and diff images (and `playwright-report/visual` in CI). If a page fails only at one width or in one vibe, the change is real for that case; if every page fails by a few pixels, suspect the browser build or fonts (see above).
