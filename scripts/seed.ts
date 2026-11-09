/**
 * Idempotent base seed: vibes, product types, settings (placeholders) and the owner admin user.
 * Safe to run repeatedly: existing rows are never overwritten, so owner edits survive a reseed.
 * Products are NOT seeded here (Phase 3).
 *
 *   pnpm db:seed          (SEED_OWNER_EMAIL, default owner@ifonli.local on a local database)
 *   pnpm db:seed --allow-remote   (against any other database; SEED_OWNER_EMAIL is then required)
 */
import { config } from "dotenv";

import { isLocalDatabase, requireLocalOrAllowRemote } from "./db-guard";

config({ path: ".env.local" });
config();

const VIBES = [
  { slug: "cute", name: "Mochi", sort: 1 },
  { slug: "funky", name: "Chaos Cabinet", sort: 2 },
  { slug: "bold", name: "Unapologetic", sort: 3 },
  { slug: "gothic", name: "After the Dark", sort: 4 },
] as const;

const PRODUCT_TYPES = [
  { slug: "charms", name: "Charms", sort: 1, definition: 'PLACEHOLDER — owner to define "Charms"' },
  {
    slug: "hippers",
    name: "Hippers",
    sort: 2,
    definition: 'PLACEHOLDER — owner to define "Hippers"',
    // Retired from the storefront (migration 0007); the row stays so old order lines keep their product type.
    active: false,
  },
  {
    slug: "3d-stickers",
    name: "3D Stickers",
    sort: 3,
    definition: 'PLACEHOLDER — owner to define "3D Stickers"',
  },
  {
    slug: "diy-accessories",
    name: "DIY Accessories",
    sort: 4,
    definition: 'PLACEHOLDER — owner to define "DIY Accessories"',
  },
] as const;

async function main() {
  requireLocalOrAllowRemote("seed", "create the base data and an owner account");
  if (!isLocalDatabase() && !process.env.SEED_OWNER_EMAIL?.trim()) {
    throw new Error("SEED_OWNER_EMAIL is required when seeding a database that is not local (no default owner is created there)");
  }
  const { getDb } = await import("../src/server/db");
  const { productTypes, user, vibes } = await import("../src/server/db/schema");
  const { seedMissingSettings } = await import("../src/server/services/settings");
  const db = getDb();

  const insertedVibes = await db
    .insert(vibes)
    .values(
      VIBES.map((v) => ({
        ...v,
        description: `PLACEHOLDER — short description of the ${v.name} vibe`,
      })),
    )
    .onConflictDoNothing({ target: vibes.slug })
    .returning({ id: vibes.id });

  const insertedTypes = await db
    .insert(productTypes)
    .values(PRODUCT_TYPES.map((t) => ({ ...t })))
    .onConflictDoNothing({ target: productTypes.slug })
    .returning({ id: productTypes.id });

  const insertedSettings = await seedMissingSettings();

  const ownerEmail = (process.env.SEED_OWNER_EMAIL || "owner@ifonli.local").trim().toLowerCase();
  // Direct insert consistent with Better Auth's `user` table. The owner signs in via email OTP
  // (OTP is logged to the server console in dev) and then enrols TOTP.
  await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Owner",
      email: ownerEmail,
      emailVerified: true,
      role: "owner",
    })
    .onConflictDoUpdate({ target: user.email, set: { role: "owner", emailVerified: true } });

  console.log(
    `seed: vibes +${insertedVibes.length}, product types +${insertedTypes.length}, settings +${insertedSettings}, owner ${ownerEmail}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
