# IfOnli

India-only (INR) D2C store for charms, Hippers, 3D stickers and DIY accessories, organised by mood ("vibe"). One Next.js app serves the storefront, checkout and admin, with a signature hand button that re-skins the whole site across five vibes (Cute, Bold, Overthinking, Gothic, Funky).

## Status

Every phase of the [implementation plan](docs/PLAN.md) is built: theme engine and hand button, catalogue and search, cart and checkout (Razorpay and cash on delivery), orders, refunds, invoices and notifications, customer accounts and privacy tools, the full admin (products, inventory, collections, orders, discounts, support, customers, content, FAQ, policies, settings and launch checklist, users, audit log, reports and insights), analytics and consent, the animated hero, and the Phase 8 QA pass (visual regression, accessibility, keyboard, mobile, copy review).

What remains is owner and launch work, not code. In short: real products, photos and cutouts; the legal entity, GSTIN, support and grievance details; lawyer-reviewed policies; live Razorpay and Resend keys; domain and DNS; the live-mode smoke test; and sign-off. The shop refuses real orders until the **launch checklist** (Admin > Settings) is clear. See [docs/OWNER-INPUTS.md](docs/OWNER-INPUTS.md) for the full list and [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) for what is honestly not finished.

## Stack

- Next.js 16 (App Router, Turbopack, Cache Components), React 19, TypeScript (strict)
- Tailwind CSS v4
- Drizzle ORM, drizzle-kit and postgres.js on Supabase Postgres
- Better Auth (customers: email OTP; staff: password + authenticator app), Zod
- Vitest (unit and integration), Playwright and axe-core (e2e, accessibility, visual)
- Package manager: pnpm

## Prerequisites

- Node.js 22
- pnpm 11 (`corepack enable` or `npm i -g pnpm`)
- A Postgres 16 database. The easiest is the local Supabase stack (Docker Desktop and the Supabase CLI), which also gives you Storage for product images.

## Local setup

```bash
pnpm install
supabase start                  # local Postgres on 127.0.0.1:54322 and Storage (needs Docker)
cp .env.example .env.local      # then fill in the secrets (see below)
pnpm db:migrate                 # schema
pnpm db:seed                    # vibes, product types, settings with placeholder values
pnpm db:import-reference        # states and the pincode directory (needed for checkout)
pnpm db:seed-products           # 32 placeholder products (SKUs start with PH-)
pnpm db:seed-content            # draft policies and the FAQ
pnpm storage:setup              # public/private buckets (needs the Supabase service key)
pnpm admin:create --email you@example.com --role owner   # prints a password once
pnpm dev                        # http://localhost:3000
```

Notes:

- `.env.example` already holds the local Supabase `DATABASE_URL`. Generate each secret (`BETTER_AUTH_SECRET`, `ORDER_TOKEN_SECRET`, `CRON_SECRET`) with `openssl rand -hex 32`.
- Seeded names, prices, stock and copy are **placeholders**. Policies stay drafts until the owner publishes them; in development they render with a "DRAFT" banner.
- Without Razorpay keys the checkout uses an in-memory **dev mock** of the payment dialog (development only; production refuses to start without real keys). Without a Resend key, emails (including sign-in codes) are written to `.dev-mail/` as `.html` and `.txt`.
- Sign in to `/admin` with the account from `admin:create`; you are asked to enrol an authenticator app on first sign-in. Customers sign in with an emailed code.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint (includes the ban-raw-hex rule) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` | Prettier (write) |
| `pnpm test` | Vitest unit tests, single run |
| `pnpm test:watch` | Vitest unit tests, watch mode |
| `pnpm test:integration` | Vitest integration tests against a disposable `ifonli_test` database |
| `pnpm e2e` | Playwright end-to-end and accessibility specs (starts `pnpm dev`, or uses `E2E_BASE_URL`) |
| `pnpm visual` | Visual regression against the committed baselines (needs `E2E_VISUAL=1`, see [tests/visual/README.md](tests/visual/README.md)) |
| `pnpm visual:update` | Regenerate the visual baselines |
| `pnpm contrast` | Check vibe token contrast pairs |
| `pnpm db:generate` | Generate a Drizzle migration from the schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:seed` | Seed vibes, product types and settings |
| `pnpm db:import-reference` | Import states and the pincode directory |
| `pnpm db:seed-products` | Seed the placeholder catalogue |
| `pnpm db:seed-content` | Seed draft policies and the FAQ (`--force` overwrites published ones) |
| `pnpm admin:create` | Create or update a staff account (`--email x --role owner\|admin\|fulfilment`) |
| `pnpm storage:setup` | Create the storage buckets |

Running the checks the way CI does: `pnpm typecheck && pnpm lint && pnpm test`, then `pnpm test:integration` and `pnpm e2e`. The e2e specs that place orders or use the admin need the seeded dev database and a dev server (`E2E_BASE_URL`), and are written to run one project at a time. The full list of suites, what each covers and how to run it is in [docs/TEST-REPORT.md](docs/TEST-REPORT.md).

## Docs

- [docs/PLAN.md](docs/PLAN.md): the approved implementation plan
- [docs/DECISIONS.md](docs/DECISIONS.md): decision log
- [docs/OWNER-INPUTS.md](docs/OWNER-INPUTS.md): what the owner still needs to supply, by phase
- [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md): task-oriented guide for the owner, admins and whoever packs parcels
- [docs/TEST-REPORT.md](docs/TEST-REPORT.md): test suites, how to run them, results and coverage of the acceptance checks
- [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md): honest list of open issues with severity
- [docs/THEMING.md](docs/THEMING.md), [docs/HERO.md](docs/HERO.md), [docs/ANALYTICS.md](docs/ANALYTICS.md), [docs/CATALOG.md](docs/CATALOG.md), [docs/DATA-MODEL.md](docs/DATA-MODEL.md): subsystem notes
- [docs/COPY-CHECKLIST.md](docs/COPY-CHECKLIST.md): the dark-pattern copy checklist used in review
- [docs/RUNBOOK.md](docs/RUNBOOK.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): deploy, rollback, key rotation, restore, and how the pieces fit (maintained with the security and CI work)
