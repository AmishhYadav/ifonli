# Launch guide (owner)

Everything you have to do to take IfOnli from "code finished" to "live and taking real orders", in order. Each step says where to click or what to run, and how to know it worked. Steps marked **(slow)** take days or weeks on someone else's side: start them first.

The shop protects you while you work through this: a production deploy refuses real orders until **Admin > Settings > Launch checklist** shows no blockers, and the server refuses to start if a required secret is missing.

Related: [OWNER-INPUTS.md](./OWNER-INPUTS.md) (the full list of business inputs), [RUNBOOK.md](./RUNBOOK.md) (operations detail), [ADMIN-GUIDE.md](./ADMIN-GUIDE.md) (using the admin), [KNOWN-ISSUES.md](./KNOWN-ISSUES.md).

---

## Part A. Start the slow things now

### A1. Business details (you)
Write these down; you will type them into Admin > Settings later and Razorpay asks for most of them.
- Legal entity name and registered address (as on PAN/GST documents)
- Business state (place of supply)
- Customer-care email, phone, support hours, response-time promise
- Grievance officer: name, designation, email, phone (required by the Consumer Protection (E-Commerce) Rules)
- Default manufacturer / packer / importer and country of origin
- One-line definition of "Hippers" (shown on the Hippers page)

### A2. Accountant (CA) **(slow)**
Ask your CA, in writing:
1. GSTIN: are you registered? (Decides "Tax invoice" vs "Bill of supply".)
2. HSN code and GST rate for each product type.
3. Shipping fee and COD fee: taxed at the rate of the main item in the order, or separately? (setting `shipping_tax_rule`)
4. GST state code for Dadra and Nagar Haveli and Daman and Diu (the app uses 26).
5. Credit notes: the shop does not issue credit notes when an order is cancelled or refunded, and COD orders get their invoice number when placed. Is that acceptable, or do they want credit notes / numbering at dispatch?
6. Ask them to check one sample invoice PDF (from a test order in Part E).

### A3. Lawyer **(slow)**
The seven policies are drafts in `content/policies/` (shipping, cancellation, returns and refunds, privacy, terms, grievance, seller information). They are templates, not legal advice. Send them for review, especially privacy (DPDP Act 2023), returns, grievance and seller information. Also ask about: data retention periods (two settings: order records, other data), the wording "A real person reads every report" in the Report-a-problem dialog, and first-party analytics running without a consent banner when GA4 is off.

### A4. Razorpay account and KYC **(slow, can take 1–3 weeks)**
1. Sign up at razorpay.com with the business PAN and bank account.
2. Submit KYC documents (PAN, bank proof, business proof, GSTIN if registered).
3. Razorpay checks your website. It must show: contact details, terms, privacy, refund/cancellation and shipping policies, and product prices. Use the **staging** site from Part C for this, with your real business details filled in and the policies published on staging.
4. While KYC is pending you can already use **test mode** keys (Part E).

### A5. Domain
Buy the domain (e.g. ifonli.in / .com) from any registrar. You need access to its DNS settings for Vercel (Part F) and Resend (B3).

### A6. Products, photos and cutouts
For every product: name, SKU, price, MRP, stock, vibe(s), type, variants, description, net quantity, country of origin, manufacturer, HSN/GST (from A2). Photos: consistent ratio. Transparent cutouts (PNG, same angle and lighting, at least 1200 px) for the animated hero: **at least 8 per vibe**.

### A7. Brand sign-off
The fonts, colours, hand icons and hero motion per vibe are proposals (see THEMING.md, HERO.md). Either approve them or send replacements (logo files, brand fonts, colours). The plan asks for written approval of the visual direction.

---

## Part B. Accounts and services

### B1. Vercel (hosting) — Pro plan required
The cron jobs run every 5 and 10 minutes; Vercel allows that only on **Pro**.
1. vercel.com, create a team on the Pro plan.
2. Add New > Project > import the GitHub repo `AmishhYadav/ifonli`. Framework: Next.js (auto). Don't deploy yet; first add env vars (Part C).
3. Project > Settings > Functions > Function Region: **Mumbai (bom1)** (`vercel.json` also pins it; the database is in Mumbai).
4. Optional: install the Vercel CLI (`npm i -g vercel`) for `vercel env pull` and logs.

### B2. Supabase (database and image storage)
You already have `ifonli-staging` (Mumbai). Production needs its own project.
1. Staging: Project Settings > Database > **Reset database password** (the old one is unknown). Save it in a password manager.
2. Create **`ifonli-prod`** in region **ap-south-1 (Mumbai)** on the **Pro** plan (daily backups and point-in-time recovery).
3. For each project, note from Connect: the **Transaction pooler** string (port 6543, for `DATABASE_URL`), the **Session pooler** string (port 5432, for `DIRECT_URL`), the project URL (`SUPABASE_URL`) and the **service_role** key (Project Settings > API).
4. Extra safety: Project Settings > Data API > turn off the Data API, or remove `public` from "Exposed schemas". The app never uses it; it talks to Postgres directly.

> Before the first `db:migrate` on staging or production, the database lockdown migration (row-level security on and public roles revoked) must be in the code. Hosted Supabase gives its public API roles full access to new tables by default. See "Still to do in code" at the end.

### B3. Resend (email)
1. resend.com, sign up, Domains > Add domain (e.g. `mail.ifonli.in` or the root domain).
2. Add the DNS records Resend shows (SPF/TXT, DKIM, and the MX for the bounce subdomain) at your registrar. Add a DMARC record too (`_dmarc` TXT, start with `v=DMARC1; p=none; rua=mailto:you@domain`).
3. Wait for "Verified".
4. API Keys > Create (sending access). This is `RESEND_API_KEY`. `EMAIL_FROM` is e.g. `IfOnli <orders@ifonli.in>` on the verified domain.

### B4. Razorpay settings (test mode first)
1. Dashboard > Account & Settings > API Keys: generate **test** keys (`rzp_test_...`).
2. Payment capture settings: **automatic capture ON**.
3. Webhooks > Add: URL `https://<your staging or live domain>/api/webhooks/razorpay`, a new random secret (`openssl rand -hex 32`, different from the key secret), events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.
4. Repeat steps 1–3 in **live** mode after KYC approval (live keys start with `rzp_live_`).

### B5. Optional
- Sentry (error alerts): create a Next.js project, copy the DSN to `SENTRY_DSN`.
- Google Analytics 4: create a property, copy the measurement id (`G-...`). Set it in Admin > Settings or as `NEXT_PUBLIC_GA4_ID`.

---

## Part C. First deploy to staging

### C1. Environment variables (Vercel > Project > Settings > Environment Variables)
Set these for **Preview** (staging, test keys). Generate each secret with `openssl rand -hex 32`.

| Variable | Value |
|---|---|
| `DATABASE_URL` | staging transaction pooler string (port 6543) |
| `DIRECT_URL` | staging session pooler string (port 5432) |
| `NEXT_PUBLIC_SITE_URL`, `BETTER_AUTH_URL` | the staging URL, `https://...`, no trailing slash |
| `BETTER_AUTH_SECRET`, `CRON_SECRET` | new random 64-character values (keep different per environment) |
| `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` | staging project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | staging service_role key |
| `RAZORPAY_KEY_ID`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | **test** keys |
| `RAZORPAY_WEBHOOK_SECRET` | the test webhook secret from B4 |
| `RESEND_API_KEY`, `EMAIL_FROM` | from B3 |
| `SENTRY_DSN` | optional |
| `CSP_MODE` | leave unset (report-only) on staging for now |

Never set `NEXT_PUBLIC_ENABLE_DEV_PAGES` or `ADMIN_PASSWORD` in Vercel.

### C2. Prepare the staging database (from your laptop)
Export the staging values in the terminal (`export DATABASE_URL='...'` and so on for `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BETTER_AUTH_SECRET`). Exported values win over your local `.env.local`. Then:
```bash
pnpm install
pnpm db:migrate                                   # uses DIRECT_URL (session pooler)
SEED_OWNER_EMAIL=you@domain pnpm db:seed --allow-remote
pnpm db:import-reference                          # states + pincode directory (see D5 for a fresh file)
pnpm db:seed-content                              # draft policies + FAQ (inserts only what is missing)
pnpm storage:setup                                # image buckets
pnpm admin:create --email you@domain --role owner --allow-remote
```
The last command prints a password once. The seed and admin scripts refuse any database that is not on your own machine unless you pass `--allow-remote`, and they print the host they would use: check it is the one you meant. Do **not** run `db:seed-products` (placeholder catalogue) on staging or production. Open a new terminal afterwards so the staging values don't linger.

### C3. Deploy and check
1. Push a branch / open a PR: Vercel builds a Preview. (The build reads products from the database, so C2 must be done first.)
2. Open `https://<preview>/api/health`. It should say ok.
3. If the deploy answers every request with an error, open the function logs and look for `Invalid production environment`: it lists the missing variables by name.
4. Go to `/admin`, sign in with the printed password, set a new password and scan the QR code with an authenticator app. Save the backup codes somewhere safe.

---

## Part D. Fill the shop (in Admin, on staging first)

Work until **Admin > Settings > Launch checklist** shows zero blockers. It links each problem to the screen that fixes it.

### D1. Settings (Admin > Settings)
Fill every setting marked required. Main groups:
- **Store and legal:** legal name, registered address, business state, customer-care email/phone/hours, response time, grievance officer, default manufacturer, default country of origin, jurisdiction city, service providers, what Hippers are, materials note, working days.
- **Tax:** default GST rate (in basis points: 18% = 1800), shipping/COD tax rule (from A2).
- **Shipping:** serviceability mode, flat fee and free-shipping threshold (in **paise**: Rs 49 = 4900), processing days, delivery estimates by zone, courier partner(s), delivery attempts, after return-to-origin.
- **COD:** on/off, COD fee, maximum COD order value (the cap includes the COD fee), excluded pincodes.
- **Inventory:** reservation window (minutes), low-stock threshold, max quantity per line.
- **Cancellation and returns:** cancellable statuses, return policy type, returns window, damaged-claim window, refund timelines, return conditions (only if returns are allowed).
- **Vibes:** hand-button order, default vibe, animated hero on/off.
- **Notifications:** admin alert emails.
- **Data retention:** order records, other data (from A3).

Values in paise and basis points are easy to get wrong. Double-check the cart total on a test order.

### D2. Products (Admin > Products)
Create real products with variants, prices, MRP, stock, vibes and types, legal fields, HSN/GST. Upload photos and cutouts (product images are cleaned of location data automatically).

### D3. Collections, content and FAQ
- Admin > Collections: copy for each vibe and type page.
- Admin > Content: announcement bar, banners, featured products per vibe, hero tiles (at least 8 cutouts per vibe for the animated hero).
- Admin > FAQ: review and publish answers.

### D4. Policies
After the lawyer's changes: Admin > Policies, edit each policy, set the effective date, **publish** (owner only). A policy with an unfilled setting cannot be published; the editor shows which value is missing.

### D5. Pincodes
The pincode directory is a 2019 snapshot (newer pincodes show as "unknown" at checkout). Download a fresh "All India Pincode Directory" CSV from data.gov.in (needs a free login), replace the file in `data/reference/`, run `pnpm db:import-reference` with the staging (later production) `DATABASE_URL` exported. Delivery zones in `data/reference/zones.json` are a placeholder grouping: adjust them to your courier's real delivery times.

### D6. Coupons and staff
- Admin > Discounts: create launch coupons if any.
- Admin > Users: add staff (owner / admin / fulfilment). Each gets a temporary password, must change it while setting up their authenticator, and it expires after 7 days unused.

---

## Part E. Test everything on staging

Use Razorpay **test mode**. Check each email arrives in the inbox (not spam) and looks right.

1. **Prepaid success:** buy with the test card (Razorpay docs list test card numbers) and with UPI id `success@razorpay`. Order page shows Paid; confirmation email arrives; download the invoice PDF and send it to your CA.
2. **Prepaid failure:** UPI `failure@razorpay`. Order stays unpaid; you can retry from the order page.
3. **Dismiss:** open the payment window and close it. The cart keeps its items; placing the order again works.
4. **COD:** place a COD order, then cancel it from the order page. Stock comes back.
5. **Admin flow:** pack and ship an order with a courier and AWB; the customer sees Shipped and gets the email. Cancel a paid order from admin: refund created, status and email update. Do a partial refund.
6. **Support:** Report a problem from an order; resolve it in Admin > Support with a refund and with a replacement.
7. **Account:** sign in with an emailed code, save an address, check the order history, download "my data", delete a test account.
8. **Coupons:** valid, expired, below minimum order.
9. **Real devices:** an Android phone (Chrome) and an iPhone (Safari), on mobile data. Whole journey: browse, switch vibes with the hand button, cart, checkout.
10. **Screen reader (quick pass):** VoiceOver on iPhone or TalkBack on Android: hand button, add to cart, checkout form.
11. **Security headers:** browse the whole site for a day with the browser console open, including a test payment. If there are no "Content Security Policy" report messages, set `CSP_MODE=enforce` in Vercel (Preview first, then Production) and redeploy. The launch checklist blocks real orders until it is enforced.
12. **Speed:** run PageSpeed Insights (pagespeed.web.dev) on the staging home, a product page, a collection and checkout, mobile. Targets: home and product 85+, others 90+, LCP under 2.5 s. On the CI runner the home page currently scores 0.57–0.77 (CI's machine is slower than real hosting; measure on Vercel).

Anything that fails: note the page, time and what you did, and send it to me.

---

## Part F. Go live

1. **Production env vars** in Vercel (Production scope): same list as C1, but with the **prod** Supabase values, the **live** domain for `NEXT_PUBLIC_SITE_URL`/`BETTER_AUTH_URL`, **live** Razorpay keys and live webhook secret, new `BETTER_AUTH_SECRET` and `CRON_SECRET`, and `CSP_MODE=enforce`.
2. **Production database:** run C2 against `ifonli-prod` (migrate, seed, reference import, seed-content, storage setup, create owner). Then enter the real settings, products, content and policies (D1–D6) in the production admin. (There is no copy tool from staging to production.)
3. **Domain:** Vercel > Project > Settings > Domains > add your domain. Add the DNS records Vercel shows at your registrar. Wait for the certificate.
4. **Razorpay live webhook:** B4 step 3 with the live domain URL, in live mode.
5. **Deploy:** merge to `main`. Check `https://<domain>/api/health` and that Admin > Settings > Launch checklist shows **zero blockers**.
6. **Live smoke test:** create a Rs 1 hidden test product. Buy it with UPI and with a card, using your own money. Refund both from the admin and confirm the money returns. Place a COD order and cancel it. Then archive the test product.
7. **Search engines:** Google Search Console > add the domain > submit `https://<domain>/sitemap.xml`.
8. **Sign-off:** you confirm everything in Parts D–F is done. You are live.

---

## Part G. After launch

- **Daily (first weeks):** check Sentry (if set up), Admin > Dashboard, and the admin alert emails (payment anomalies, failed emails, low stock).
- **Health:** `https://<domain>/api/health` should always be ok. Vercel > Logs for errors. Cron jobs run on their own (RUNBOOK section 7).
- **Backups:** Supabase Pro takes daily backups. Do one restore drill in the first month (RUNBOOK section 5).
- **Secrets:** never paste keys in chat. If one leaks, rotate it (RUNBOOK section 4). Changing `BETTER_AUTH_SECRET` signs everyone out and resets every admin's authenticator.
- **Phase 9 (optional, later):** Shiprocket for live shipping rates and labels, WhatsApp notifications, DIY mix-and-match builder, reviews.

---

## Still to do in code (developer side, not you)

Found in the deep review of 2026-10-31 and not yet built; each waits for your go-ahead:
- **Database lockdown migration** (must land before Part C2): row-level security on every table, revoke the public API roles, block edits to the audit log, plus a few extra database safety constraints.
- Admin screen to manage serviceable pincodes (today only the import script sets them).
- Inventory CSV import (export exists).
- Redirects when a product URL (slug) changes.
- The "payment failed" customer email (template exists, never sent).
- Automatic deletion of old personal data after the retention periods you choose in D1.
- Screenshot (visual regression) baselines generated on CI and committed.
