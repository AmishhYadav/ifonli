# IfOnli runbook

Operational reference: environment, deploys, migrations, key rotation, backups and restore, incidents, cron jobs, rate limits and the CSP switch. Architecture is in [ARCHITECTURE.md](./ARCHITECTURE.md), decisions in [DECISIONS.md](./DECISIONS.md).

Monitoring entry points
- Uptime: `GET /api/health` (200 `{"status":"ok","db":"ok"}`; 503 when the database does not answer in 2 s). Point the uptime monitor here, alert after 2 failures.
- Errors: Sentry (needs `SENTRY_DSN`; tagged with the git SHA as `release`). The launch gate in the admin settings area checks that `SENTRY_DSN` is set.
- CSP: `[csp]` lines in the Vercel runtime logs (see "CSP mode").

---

## 1. Environment variables

Set in Vercel (Project, Settings, Environment Variables). Use separate **Production**, **Preview** and **Development** values; Razorpay test keys on Preview, live keys on Production only. `.env.example` is the local template.

| Variable | Required in prod | Secret | Used for / notes |
|---|---|---|---|
| `DATABASE_URL` | yes | yes | Supabase **pooled** (transaction pooler, port 6543) connection string. The app uses `prepare: false`, a small pool (5 connections per instance) and requires TLS for any host that is not localhost |
| `DIRECT_URL` | for migrations | yes | Supabase **direct** connection (port 5432). Used by `drizzle-kit migrate`; falls back to `DATABASE_URL` |
| `NEXT_PUBLIC_SITE_URL` | yes | no | Public origin (`https://...`, no trailing slash; `http://localhost` is accepted only so a production build can be tried on one machine). Canonical URLs, sitemap, OG, links in e-mails, CSP `upgrade-insecure-requests` |
| `BETTER_AUTH_SECRET` | yes | yes | Signs sessions and cookies, and encrypts the admins' authenticator secrets and backup codes (see section 4 before changing it). `openssl rand -hex 32`, at least 32 characters. A production server refuses to boot without it (see "Boot check" below) |
| `BETTER_AUTH_URL` | yes | no | Same origin as the site |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | yes | no | Storage API base. Also drives `next/image` `remotePatterns` and the CSP `img-src`/`media-src` (read at **build** time) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **yes** | Server-only Storage access (uploads, signed URLs). Never expose to the browser |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | yes | secret: yes | Orders API and capture verification. Keys empty in production means checkout fails loudly (by design) |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | yes | no | Checkout.js key id (same as `RAZORPAY_KEY_ID`) |
| `RAZORPAY_WEBHOOK_SECRET` | yes | yes | HMAC of `/api/webhooks/razorpay`. A **different** secret from the key secret |
| `RESEND_API_KEY` / `EMAIL_FROM` | yes | key: yes | Transactional e-mail. `EMAIL_FROM` like `IfOnli <orders@your-domain>` on a Resend-verified domain |
| `CRON_SECRET` | yes | yes | Vercel Cron sends it as `Authorization: Bearer ...`; with no secret every cron call is rejected. At least 32 characters |
| `SENTRY_DSN` | recommended | semi | Enables error reporting. Empty = reporter is a no-op |
| `NEXT_PUBLIC_GA4_ID` | optional | no | GA4 measurement id (wins over the admin setting `ga4_measurement_id`). The CSP always allows the Google origins, so the admin setting works without it |
| `CSP_MODE` | no | no | `report-only` (default) or `enforce`. **Build time**, see section 9 |
| `VERCEL_GIT_COMMIT_SHA`, `VERCEL_ENV` | set by Vercel | no | Release tag and environment label on error reports; short SHA in `/api/health` |
| `NEXT_DIST_DIR` | dev only | no | Separate build output dir for parallel local servers |
| `SEED_OWNER_EMAIL` | seed only | no | Owner admin created by `pnpm db:seed`. Required (no default) when the database is not local |
| `ADMIN_PASSWORD` | scripts only | **yes** | Password for `scripts/create-admin.ts` when `--password` is not given (keeps it out of shell history). Never set it in Vercel |
| `NEXT_PUBLIC_ENABLE_DEV_PAGES` | **never in prod** | no | Test/review builds only: exposes `/styleguide`, `/dev/*`, the e-mail preview and unpublished policies, and switches the order gate off. The launch checklist flags it. Build time |

**Boot check.** A production server (`NODE_ENV=production`, not `next build`) checks its environment in `instrumentation-node.ts` and exits at startup, with a message listing every problem by variable name (never the values), when any of these is missing or weak: `NEXT_PUBLIC_SITE_URL` (https), `BETTER_AUTH_SECRET` and `CRON_SECRET` (32+ characters), `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. A deploy with a bad environment therefore fails its first request instead of sending e-mails with `localhost` links. Check the function logs of a failed deployment for the line `Invalid production environment`.

**Function region.** `vercel.json` pins functions to `bom1` (Mumbai), next to the Supabase database (ap-south-1). Without it Vercel defaults to `iad1` and every query crosses the world. Keep the project's Function Region setting at Mumbai (bom1) too if it is set in the dashboard.

**Plan.** The cron schedule includes jobs more often than daily (every 5 and 10 minutes, hourly), which Vercel allows only on the **Pro** plan; on Hobby the deploy is rejected.

Local-only test helpers: `IFONLI_TEST_DB` (integration test database name), `E2E_BASE_URL`, `PW_CHROMIUM_PATH`, `E2E_ADMIN_FLOW`, `E2E_MOCK_CHECKOUT` (see the README).

---

## 2. Deploy and roll back (Vercel)

**Deploy.** Merging to `main` builds and deploys Production; every PR gets a Preview. The build runs `next build`, which **prerenders product, vibe and type pages from the database**: the Production build therefore needs `DATABASE_URL` pointing at a migrated database. Order matters when a release has a migration: run the migration first (section 3), then deploy.

Before a release
1. CI green on the PR (static, integration, e2e-dev, prod jobs).
2. `GET /api/health` on the Preview URL returns ok.
3. If the release changes env vars, set them for Production **before** merging (env changes need a redeploy to take effect).

**Roll back.** Vercel, Deployments, pick the last good deployment, "Promote to Production" (or "Instant Rollback"). It is instant and does not rebuild. Rollback does not touch the database: a release with a destructive migration must not be rolled back past it (see section 3, expand then contract). After rolling back, check `/api/health` and one product page.

Cache note: a rollback swaps the code; cached catalogue entries tagged in the data cache stay valid. If a bad release wrote wrong content, call an admin action that revalidates (any product save) or redeploy.

---

## 3. Migrations in production

Migrations are Drizzle SQL files in `drizzle/` (committed). They are applied with the **direct** connection:

```bash
DIRECT_URL='postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres' pnpm db:migrate
```

Use the Supabase **session pooler** host (`...pooler.supabase.com`, port **5432**; the username is `postgres.<ref>`) for `DIRECT_URL`. The `db.<ref>.supabase.co` direct host is IPv6-only, so it fails from GitHub Actions, most laptops on IPv4 networks and anywhere else without IPv6. Copy the exact string from Supabase, Connect, Session pooler.

Rules
- Take a manual backup first (section 5: Supabase dashboard, Database, Backups, or `pg_dump`).
- Migrations are forward-only. For anything destructive use **expand then contract**: release 1 adds the new column/table and writes both; release 2 stops reading the old one; release 3 drops it. That keeps rollback (section 2) safe.
- `pg_trgm` and `unaccent` are created by migration `0000_extensions.sql`; Supabase allows both.
- **Migration 0005 (RLS lockdown, audit-log trigger, new indexes, must-change-password column).** Apply it to every Supabase project **before** the app is reachable and before any data is loaded; hosted Supabase otherwise leaves `anon` / `authenticated` with full CRUD on every table through the Data API. Order for a new staging or production project: (1) `pnpm db:migrate` (all migrations, as `postgres`, with the session-pooler `DIRECT_URL`); (2) verify: `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;` returns no rows, and `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated');` returns no rows (the Supabase dashboard's Security Advisor should also show no "RLS disabled" findings); (3) seed and deploy. On a database that already has data, run it before deploying the matching release: it moves the "must change password" markers out of `verification` into `user.password_change_deadline` (the previous release does not read the column, so a pending temporary password would not be enforced during the gap; deploy right after). It also adds `UNIQUE (order_id, variant_id)` on `stock_reservations` and a partial unique index on `payments`; if either fails on old data, the message names the duplicate rows to fix by hand.
- Every new table needs `.enableRLS()` in its Drizzle definition (a test enforces it). `admin_audit_log` rejects UPDATE and DELETE by trigger; do not "clean" it from SQL (only the owner can TRUNCATE, which is for tests, never production).
- Never edit an applied migration. Fix forward with a new one (`pnpm db:generate`).
- Seed and admin scripts run under `tsx`, where `NODE_ENV` is not set, so they decide by the **host in `DATABASE_URL`**: anything other than localhost/127.0.0.1 is refused unless `--allow-remote` is passed. Export the production `DATABASE_URL` for the command (or put it in `.env.local`), and double-check the host the script prints if it refuses.
- First-time production data: `SEED_OWNER_EMAIL=you@domain pnpm db:seed --allow-remote` (vibes, product types, settings, owner row; `SEED_OWNER_EMAIL` is required against a remote database) and `pnpm exec tsx --conditions=react-server scripts/seed-content.ts` (policies stay DRAFT/unpublished until the owner publishes; it only inserts what is missing and never touches a policy edited in admin or a published one, so it needs no `--allow-remote`; `--force` overwrites and does need it). **Do not run `db:seed-products` in production** (placeholder catalogue; it refuses a remote database or `NODE_ENV=production` unless both `--force-placeholder` and `--allow-remote` are given).
- Create the owner admin: `ADMIN_PASSWORD='...' pnpm exec tsx --conditions=react-server scripts/create-admin.ts --email you@domain --role owner --allow-remote` (omit `ADMIN_PASSWORD` to get a generated password printed once; TOTP is enrolled at first login).
- Staff added from the admin Users screen get a temporary password: they must replace it while setting up their authenticator, and it stops working after 7 days (an owner can reset it from the same screen).
- Storage buckets: `pnpm storage:setup` once per project (creates `products`, `cutouts`, `content` public and `private`).

---

## 4. Rotating secrets

Always rotate in this order: create the new value, set it in Vercel, redeploy, verify, revoke the old one.

| Secret | Procedure | Impact |
|---|---|---|
| **Razorpay API key** (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`) | Razorpay Dashboard, Account & Settings, API Keys, Regenerate (live keys need the dashboard 2FA). Set all three in Vercel, redeploy. Old key stops working immediately on regeneration, so do it in a quiet period and place a test order afterwards | Checkout fails between regeneration and deploy. Open orders still verify through the webhook and the reconcile cron |
| **Razorpay webhook secret** (`RAZORPAY_WEBHOOK_SECRET`) | Razorpay Dashboard, Webhooks, edit the endpoint, set a new secret. Update Vercel and redeploy immediately. Webhooks signed with the old secret are rejected with 401 and **Razorpay retries**; the reconcile cron (every 10 min) also repairs any gap | Short window of rejected webhooks, self-healing |
| **Better Auth secret** (`BETTER_AUTH_SECRET`) | `openssl rand -hex 32`, set, redeploy, then **re-enrol every admin's authenticator** (below) | **Signs everyone out** (customers and admins). In-flight OTP codes become invalid. **Locks every admin out of two-factor**: Better Auth encrypts each admin's TOTP secret and backup codes with this secret, so after a change they can no longer be read and every authenticator code is rejected |
| **Cron secret** (`CRON_SECRET`) | New value in Vercel, redeploy. Vercel Cron sends the current value of the env var, so there is no gap beyond the deploy | A cron run during the deploy may 401 and runs again on the next tick |
| **Resend** (`RESEND_API_KEY`) | Resend dashboard, API Keys, create a new key with "sending access", set in Vercel, redeploy, send a test (place a COD test order or use the contact form), then delete the old key | E-mails queue in the outbox and retry (notify-retry cron) if sending fails during the swap |
| **Supabase service role key** | Supabase, Project Settings, API, roll the JWT secret / key; set `SUPABASE_SERVICE_ROLE_KEY`, redeploy | Image uploads and invoice downloads fail until redeployed |
| **Database password** | Supabase, Database, Reset password. Update `DATABASE_URL` and `DIRECT_URL`, redeploy | Brief connection errors |
| **Sentry DSN** | Sentry, Client Keys, rotate; update `SENTRY_DSN` | Errors not reported until redeployed |

**Re-enrolling admins after a `BETTER_AUTH_SECRET` change.** Nobody can sign in to /admin, so this is done from a machine that has the production `DATABASE_URL` (and the new `BETTER_AUTH_SECRET` in the environment). For each staff account, starting with an owner:

```bash
pnpm exec tsx --conditions=react-server scripts/create-admin.ts \
  --email person@domain --role <their current role> --reset-2fa --allow-remote
```

That drops the stored authenticator (`two_factor` row), turns two-factor off for the account and sets a new password (generated and printed once, or pass `ADMIN_PASSWORD`); give it to the person over a private channel. They sign in with the password, scan a new QR code and save new backup codes. Without the script, the same by hand: `delete from two_factor where user_id = '<id>'; update "user" set two_factor_enabled = false where id = '<id>'; delete from session where user_id = '<id>';`, then set a password with the script. Once an owner is back in, the other staff can be reset from the admin Users screen ("Reset two-factor"). If rotation is only a precaution, plan it for a quiet moment and do the owner first.

After any rotation: `GET /api/health`, one storefront page, admin login, and (for payment secrets) a test order.

---

## 5. Backups, PITR and the restore drill

**What exists.** Supabase runs daily backups; Point-in-Time Recovery (PITR) is a paid add-on that gives second-level recovery. The plan also calls for a weekly `pg_dump` to private storage via a GitHub Action (not set up yet: owner decision, tracked in OWNER-INPUTS). Enable PITR before launch if the plan allows it.

**Manual dump** (also before every production migration):

```bash
pg_dump --format=custom --no-owner --no-privileges \
  "$DIRECT_URL" --file "ifonli-$(date +%F).dump"
```

Store the file encrypted and off the machine it was created on.

**Restore drill (do it once before launch, then quarterly).** Goal: prove a backup restores and the app runs on it, and measure how long it takes.
1. Create a scratch Supabase project (or a local Postgres 16 with `pg_trgm`/`unaccent` available).
2. Restore: Supabase dashboard, Database, Backups, "Restore" (to a new project), **or** `pg_restore --clean --if-exists --no-owner -d "$SCRATCH_DIRECT_URL" ifonli-YYYY-MM-DD.dump`.
3. Point a Preview deployment (or a local `pnpm start`) at the scratch `DATABASE_URL` and check: `/api/health` ok; a product page; an order lookup on `/track`; admin login; dashboard totals look right.
4. Verify integrity: row counts for `orders`, `payments`, `inventory_movements`; the ledger invariant (sum of `inventory_movements.delta` per variant equals `variants.stock_on_hand`); `select count(*) from orders where payment_status = 'paid' and not exists (select 1 from payments p where p.order_id = orders.id and p.status = 'captured')` is 0.
5. Record the date, the backup used, time to restore and any problems in the incident log; delete the scratch project.

**PITR recovery** (data corruption or a bad bulk edit): Supabase, Database, Backups, Point in Time, pick the timestamp just before the incident, restore to a **new** project, verify as above, then either repoint `DATABASE_URL` to it or copy the affected rows back. Storage objects (images, invoices) are not part of the database backup: invoices are generated from the order data (re-issue them from the order page if the admin offers it, otherwise from the database); product images must be re-uploaded or restored from the originals.

---

## 6. Incident checklist

1. **Confirm and scope.** `/api/health`; Vercel Deployments (did a deploy just finish?); Sentry (new issue, spike?); Vercel runtime logs for 5xx.
2. **Stop the bleeding.** Recent deploy is the likely cause: roll back (section 2). A broken payment provider: set the COD toggle in admin settings so customers can still order.
3. **Payments.** Razorpay Dashboard: are payments captured but orders unpaid? The webhook and `reconcile-payments` cron repair this; run the cron manually (below) after fixing the cause. Never mark an order paid by hand without a captured payment id.
4. **Database.** Supabase dashboard: connections (pooler saturated?), CPU, disk. A stuck connection storm clears with a redeploy.
5. **E-mail.** Resend dashboard for bounces/blocks; the outbox retries with backoff (`notify-retry`).
6. **Comms.** Post on the site banner setting if customers are affected; reply to contact-form messages that arrived during the incident.
7. **After.** Write down timeline, cause, fix and prevention; add a test.

Run a cron by hand (use the production secret; do not paste it into shared channels):

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/reconcile-payments
```

---

## 7. Cron jobs (`vercel.json`)

All endpoints require `Authorization: Bearer $CRON_SECRET`. Times are UTC (IST = UTC+5:30).

| Path | Schedule | What it does |
|---|---|---|
| `/api/cron/reconcile-payments` | every 10 min | Re-checks pending payments with Razorpay, finalises captures the webhook missed, reconciles refunds |
| `/api/cron/release-reservations` | every 5 min | Checks overdue unpaid orders with Razorpay first (a late capture is finalised, not expired), then releases expired stock reservations and expires the rest |
| `/api/cron/cleanup` | daily 21:30 (03:00 IST) | Deletes expired carts, webhook events older than 90 days, rate-limit windows older than 1 day, delivered e-mails (`notification_outbox` status `sent`) older than 90 days, expired Better Auth sessions and verification rows, closed contact messages and resolved or rejected support cases past 365 days (the case text and photos are erased, the case row stays), and support photos in Storage that no case references. Returns a count for each step (`contactMessagesDeleted`, `supportCasesErased`, `orphanPhotosDeleted`, ...); each step handles at most 500 rows per run, so a backlog clears over several nights. Orders and invoices are never purged. Periods: `src/server/services/retention.ts` |
| `/api/cron/notify-retry` | every 5 min | Sends queued e-mails from the outbox and retries failures with backoff. Stops sending after 240 s (`maxDuration` 300 s); rows not reached are picked up by the next run |
| `/api/cron/low-stock-digest` | daily 03:30 (09:00 IST) | E-mails the admin a low-stock summary; queues at most one digest per India day, so re-running it the same day is harmless |
| `/api/cron/analytics-rollup` | hourly at :15 | Rebuilds `product_engagement_daily` for the last 3 India days from raw events (idempotent), then deletes raw events past the retention setting. `?days=N` (1-90) backfills further |

Failures are logged and reported to Sentry with `source: cron`. These schedules need the Vercel **Pro** plan (Hobby only allows daily crons), and the functions must run in **bom1** (see section 1, "Function region").

---

## 8. Rate limits

One Postgres table (`rate_limits`: key, window start, count) behind `consumeRateLimit`: a fixed window, one atomic upsert per attempt, correct across serverless instances; the attempt counts even when blocked. Housekeeping is the daily cleanup cron. Helpers: `src/server/services/rate-limit.ts` (service layer), `src/server/auth/rate-limit.ts` (auth), `src/server/security/action-limit.ts` (`limitByIp` for public Server Actions).

**Rule for new public endpoints:** any new public Route Handler or Server Action that writes data, sends e-mail, or runs a search must take a limiter in the same change and appear in this table.

| Surface | Kind | Key(s) | Limit |
|---|---|---|---|
| Better Auth over HTTP (`/api/auth/*`) | Better Auth handler | `ba:` IP + path (store: Postgres) | Only `get-session`, `sign-out`, `ok` and `error` exist over HTTP; every other path (OTP, sign-in, two-factor, `admin/*`) answers 404 whoever asks, so staff emails cannot be probed. Global limit 60 per 60 s per IP |
| Customer OTP, sending codes | Auth hook (also for the Server Actions) | `otp-send:<sha256(email)>`, `otp-send-ip:<sha256(ip)>` | 5 codes per 10 min per email; 20 per 10 min per IP |
| Customer OTP, wrong codes | Auth hook | `otp-fail:<sha256(email)>:<sha256(ip)>`, `otp-fail-ip:<sha256(ip)>` | Only failed attempts count: 8 per 10 min per email and IP; 30 per 10 min per IP. Sending codes never uses this budget, and a stranger cannot lock the real customer out. Each code also locks after 5 wrong tries (Better Auth) |
| Admin TOTP, per account | Better Auth | `two_factor.failed_verification_count` | 10 consecutive failures lock the account's two-factor for 15 minutes |
| Admin sign-in Server Action | Server Action | `admin-login:<ip>`, `admin-login-email:<email>` | 30 per 10 min per IP; 8 per 10 min per email |
| Admin TOTP step / enrolment | Server Action | `admin-2fa:<ip>`, `admin-enroll:<ip>` | 10 per 10 min; 8 per 10 min |
| Coupon apply | Server Action | `coupon:ip`, `coupon:cart` | 30 per 10 min per IP; 10 per 10 min per cart |
| Cart add / change / remove | Server Action | `cart:ip` | 240 per 10 min per IP (stops cart-row spam from cookie-less bots) |
| Checkout quote | Server Action | `quote:ip` | 240 per 10 min per IP |
| Pincode lookup / PDP delivery check | Server Action | `pincode:ip` | 120 per 10 min per IP |
| Place order (checkout) | Server Action | `checkout:ip`, `checkout:cart` | 20 per 10 min per IP; 10 per 10 min per cart |
| Retry payment | Server Action | `payretry:ip`, `payretry:ref` | 20 per 10 min per IP; 10 per 10 min per order |
| Payment verify `POST /api/payments/razorpay/verify` | Route Handler | `payverify:ip`, `payverify:ref` | 40 per 10 min per IP; 20 per 10 min per order |
| Guest order tracking | Server Action | `track:ip`, `track:ref-ip` | 20 per 10 min per IP; 8 per 10 min per order ref **and IP** (so someone who knows a reference cannot use up the real customer's tries) |
| Contact form | Server Action | `contact:ip`, `contact:email` | 5 per 15 min per IP; 3 per hour per email (plus a honeypot field) |
| Customer invoice download `GET /api/orders/{ref}/invoice` | Route Handler | `invoice:ip` | 30 per 10 min per IP (also needs the order token) |
| Header quick search | Server Action | `search:ip` | 90 per minute per IP (over limit returns no results) |
| Wishlist cards | Server Action | `wishlist:ip` | 60 per minute per IP |
| Customer OTP login (storefront Server Actions) | Server Action | `otp-send:ip`, `otp-send:email`, `otp-verify:ip` | Send: 10 per 15 min per IP, 5 per 15 min per email. Verify: 30 per 15 min per IP. The per-address budget for wrong codes is in the auth guards (row above), not here |
| Customer order cancel | Server Action | `cancel:ip`, `cancel:ref` | 20 per 10 min per IP; 6 per 10 min per order |
| Report a problem (support case) | Server Action | `support:ip`, `support:order` | 10 per hour per IP; 6 per day per order |
| Support photo upload URLs | Server Action | `support-upload:ip` | 20 per hour per IP (files checked for type and size before the case stores them) |
| Account data export `GET /api/account/export` | Route Handler | `account-export:<user>` | 5 per hour per account |
| Analytics beacon `POST /api/events` | Route Handler | `events:ip`, `events:sid` | 90 per minute per IP; 40 per minute per session; 8 KB and 20 events per request; bots ignored |
| CSP reports `POST /api/csp-report` | Route Handler | `csp:ip` | 60 per 10 min per IP; 16 KB body cap |
| Browser error tunnel `POST /api/monitoring` | Route Handler | `monitoring:ip` | 20 per 10 min per IP; 8 KB body cap; inert without `SENTRY_DSN` |
| Razorpay webhook `POST /api/webhooks/razorpay` | Route Handler | none | Authenticated by HMAC of the raw body (constant time) before any database work; 256 KB cap; duplicate event ids are ignored. Block abuse at the Vercel Firewall |
| Cron endpoints | Route Handler | none | Bearer secret, constant-time compare |
| `GET /api/health` | Route Handler | none | Cheap `select 1`, memoised 5 s per instance |
| Admin Server Actions, admin exports and admin invoice route | Server Action / Route | none | Behind `requireAdmin()` (session + role + TOTP + per-action permission) |
| `/api/dev/*` | Route Handler | n/a | 404 in production |


Vercel Firewall (Project, Firewall) is the second layer: add a rate-limit rule for `/api/*` (for example 300 requests per minute per IP) and enable Attack Challenge Mode during an incident.

---

## 9. CSP mode switch

Headers are defined in `src/lib/security/headers.ts` and attached in `next.config.ts`. Strategy and trade-offs: DECISIONS D-SEC-1..3.

| `CSP_MODE` | Behaviour |
|---|---|
| unset / `report-only` (default) | Always enforced: `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`. The **full** policy is sent as `Content-Security-Policy-Report-Only`, so nothing is blocked but every would-be violation is reported |
| `enforce` | The full policy is enforced |

It is read at **build time** (Next bakes `headers()` into the routes manifest). To change: Vercel, Environment Variables, set `CSP_MODE`, then **redeploy**.

Go-live procedure
1. Launch with `report-only`. Place a live test payment with the real Razorpay Checkout (UPI and card) and a COD order.
2. Search the Vercel runtime logs for `[csp]`. Each line is `[csp] <report|enforce> <directive> blocked=<origin/path> page=<path>`. Expect none.
3. If Razorpay needs another origin (their script list changes), add it to `RAZORPAY` in `src/lib/security/headers.ts`, deploy, repeat. A last-resort wildcard is `https://*.razorpay.com` in `script-src`, `frame-src`, `connect-src` and `img-src`.
4. Set `CSP_MODE=enforce` and redeploy. Re-run the live test payment. To back out, set it back and redeploy (or roll back).
5. HSTS is `max-age=31536000; includeSubDomains` in production. Add `preload` and submit to hstspreload.org only when every subdomain is HTTPS-only.

`pnpm e2e --project=chromium-desktop --grep "security:"` against `pnpm start` checks headers, endpoints and zero violations on the storefront, cart, checkout, guest tracking, help, admin login and (with `E2E_ADMIN_FLOW=1`) signed-in admin pages. Third-party origins allowed: Razorpay (always), Google Analytics/Tag Manager (always, so a GA4 id from the admin setting can load; gtag itself loads only with an id and consent), the Supabase storage host (from env).

---

## 10. Performance checks

`lighthouserc.json` holds the mobile budgets from plan section 13 (home and PDP performance 0.85, collection and cart 0.9, accessibility 0.95, best practices 0.9, SEO 0.95 except the noindex cart; LCP 2.5 s, CLS 0.05, TBT 300 ms). The CI job is non-blocking at first. Run locally:

```bash
pnpm build && pnpm start -p 3107   # in one terminal
npx lighthouse http://localhost:3107/ --chrome-flags="--headless=new --no-sandbox" --only-categories=performance
```

Scores on a shared or throttled machine vary by several points run to run; judge trends, and trust the CI runner or PageSpeed Insights on the preview URL for the number you report.
