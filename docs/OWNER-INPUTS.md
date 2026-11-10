# Owner inputs

What is still needed from the owner, as of 2026-11-10. IfOnli is a college project: there is no lawyer review and no CA or tax work, so those inputs are not needed. The real catalogue (26 products, `IFO-` SKUs, real photos) and the real store values (`content/store-values/`: legal name, support details, shipping, COD, returns, notification channels, vibe settings) are already applied. Source: plan sections 14 and 17 ([PLAN.md](./PLAN.md)); open problems are in [KNOWN-ISSUES.md](./KNOWN-ISSUES.md).

## Still needed

- [ ] **Razorpay live approval and keys** (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`). Until all three are set the launch gate keeps the store closed. Confirm auto-capture is ON in the dashboard. (K-3)
- [ ] **A Razorpay test-mode run** with the test card and `success@razorpay` / `failure@razorpay` UPI ids, then a live Rs 1 smoke test (UPI and card, refunded; a COD order placed and cancelled). (K-3)
- [ ] **Switch `CSP_MODE=enforce`** (build-time setting; now report-only) once a payment has run with no CSP reports, then redeploy. (K-3)
- [ ] **A domain** and DNS access. It replaces `ifonli.vercel.app` as the public URL (`NEXT_PUBLIC_SITE_URL`, `BETTER_AUTH_URL`). (K-4)
- [ ] **Resend domain authentication** (SPF, DKIM) on that domain, and `EMAIL_FROM` on it. Until then the free sender `onboarding@resend.dev` only delivers to the Resend account owner, so customers get no emails. (K-4)
- [ ] **Real-device and screen-reader pass** (iPhone Safari, Android Chrome, VoiceOver, TalkBack). (V-1, V-2)
- [ ] **Visual baselines**: run `pnpm visual:update` on CI's browser, review and commit. (V-5)
- [ ] **Fresh pincode directory**: a current data.gov.in extract, then `pnpm db:import-reference`. The directory is a May 2019 snapshot plus 40 newer pincodes, and the delivery zones in `data/reference/zones.json` are a placeholder grouping. (K-6)
- [ ] **Launch date and sign-off.**

## Optional

- [ ] GA4 measurement ID (`ga4_measurement_id` is empty).
- [ ] WhatsApp provider (every notification channel is email only).
- [ ] Error tracking: Sentry is not installed and `SENTRY_DSN` is unset; Vercel runtime logs are the only error trail. (V-4)
- [ ] Logo files and hand-icon art beyond the current inline hand, if the brand gets its own. The share card and home-screen icons are drawn by `pnpm brand:render`.

## Done

- [x] Real product list, prices, stock, vibes, types, descriptions and photography (26 products, `IFO-` SKUs).
- [x] Legal name, registered address, support email, phone, hours and response time.
- [x] Shipping fee and free-shipping threshold, COD on with fee and maximum, stock reservation time, cancellation and returns settings, admin alert email (`shop.ifonli@gmail.com`).
- [x] Brand: four moods (Mochi, Chaos Cabinet, Unapologetic, After the Dark), body font Nunito, display fonts Fredoka, Rubik Glitch, Bungee Shade and Creepster (all SIL OFL).
- [x] Storage buckets created, cron-job.org calling the four frequent crons, free-tier hosting live (Vercel Hobby, Supabase free, Resend free).
- [x] Policy pages written (`content/policies/`, filled from the store values). Not legally reviewed.

## Not applicable (college project)

- Lawyer review of policies, privacy and terms, and data-retention periods (`src/server/services/retention.ts`, D-RET-1).
- Tax work for a CA: HSN codes and per-product GST rates, GSTIN ("Tax invoice" or "Bill of supply"), the shipping and COD tax rule, the GST state code for Dadra and Nagar Haveli and Daman and Diu.
- Coupons, Hippers (the product line) and customer email-OTP sign-in: all retired.
