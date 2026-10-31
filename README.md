# IfOnli

India-only (INR) D2C store for charms, Hippers, 3D stickers and DIY accessories, organised by mood ("vibe"). One Next.js app serves the storefront, checkout and admin, with a signature hand button that re-skins the whole site across five vibes (Cute, Bold, Overthinking, Gothic, Funky).

The implementation plan is in [docs/PLAN.md](docs/PLAN.md). This repository is at **Phase 0 (project setup)**.

## Stack

- Next.js 16 (App Router, Turbopack, Cache Components), React 19, TypeScript (strict)
- Tailwind CSS v4
- Drizzle ORM, drizzle-kit and postgres.js on Supabase Postgres
- Better Auth, Zod
- Vitest (unit and integration), Playwright and axe-core (e2e and accessibility)
- Package manager: pnpm

## Prerequisites

- Node.js 22
- pnpm 11 (`corepack enable` or `npm i -g pnpm`)
- Docker Desktop (for the local Supabase stack)
- Supabase CLI

## Local setup

```bash
pnpm install
supabase start              # local Postgres on 127.0.0.1:54322 (needs Docker)
cp .env.example .env.local  # then fill in any secrets you need
pnpm db:migrate
pnpm db:seed
pnpm dev                    # http://localhost:3000
```

`.env.example` already holds the local Supabase `DATABASE_URL`. Generate secrets with `openssl rand -hex 32`. Until the database schema lands (Phase 3), `db:migrate` and `db:seed` have nothing to do.

## Scripts

| Script             | What it does                                           |
| ------------------ | ------------------------------------------------------ |
| `pnpm dev`         | Start the dev server (Turbopack)                       |
| `pnpm build`       | Production build                                       |
| `pnpm start`       | Serve the production build                             |
| `pnpm lint`        | ESLint                                                 |
| `pnpm typecheck`   | `tsc --noEmit`                                         |
| `pnpm format`      | Prettier (write)                                       |
| `pnpm test`        | Vitest, single run                                     |
| `pnpm test:watch`  | Vitest, watch mode                                     |
| `pnpm e2e`         | Playwright (starts `pnpm dev`, or uses `E2E_BASE_URL`) |
| `pnpm db:generate` | Generate a Drizzle migration from the schema           |
| `pnpm db:migrate`  | Apply migrations                                       |
| `pnpm db:studio`   | Open Drizzle Studio                                    |
| `pnpm db:seed`     | Seed the database                                      |
| `pnpm db:seed-products` / `db:seed-content` | Placeholder catalogue (dev only) / policies and FAQs |
| `pnpm contrast`    | Check vibe token contrast pairs                        |

## Running e2e specs locally

`pnpm e2e` starts `pnpm dev` (or uses `E2E_BASE_URL`). The prepaid-payment specs need `next dev` (the payment mock refuses to run in a production build). The security/CSP spec is meant for a production build:

```bash
pnpm build && pnpm start -p 3107
E2E_BASE_URL=http://localhost:3107 pnpm e2e --project=chromium-desktop --grep "security:"
```

If your machine has a Chromium that is not the build Playwright expects (typical in sandboxes), point Playwright at it instead of editing the config:

```bash
PW_CHROMIUM_PATH=/path/to/chrome pnpm e2e --project=chromium-desktop
```

`PW_CHROMIUM_PATH` only sets `launchOptions.executablePath` for Chromium projects and is never needed in CI. Other switches: `E2E_ADMIN_FLOW=1` (admin flows that need the dev database), `E2E_MOCK_CHECKOUT=1` (checkout up to the dev mock payment dialog, `next dev` only).

## Docs

- [docs/PLAN.md](docs/PLAN.md): the approved implementation plan
- [docs/DECISIONS.md](docs/DECISIONS.md): decision log
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system diagram, data flows, caching, auth
- [docs/RUNBOOK.md](docs/RUNBOOK.md): env vars, deploy/rollback, migrations, key rotation, backups, rate limits, CSP switch
- [docs/OWNER-INPUTS.md](docs/OWNER-INPUTS.md): what the owner still needs to supply, by phase
