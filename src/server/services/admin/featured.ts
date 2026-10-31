import "server-only";

import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import { assertCan } from "@/server/auth/permissions";
import { featuredSlots, productImages, products, vibes } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { getHeroTilesForAllVibes } from "@/server/services/catalog";
import type { DbClient } from "@/server/services/queries/shared";

import { AdminInputError, type AdminActor } from "./products";

/**
 * Curated product sets per vibe: `home_featured` (the home page "featured" row) and `hero_tiles` (the
 * poster / animated hero collage). When a vibe has no curated tiles the storefront falls back to the
 * vibe's products that have a cutout; `getFeaturedHeroStats` reports what the storefront will really show.
 */

export type FeaturedPlacement = (typeof featuredSlots.$inferSelect)["placement"];
export const FEATURED_PLACEMENTS = ["home_featured", "hero_tiles"] as const satisfies readonly FeaturedPlacement[];

/** Hero tiles per vibe needed for a full collage (plan section 9). */
export const HERO_TILES_MIN = 8;
/** The storefront reads at most this many per vibe (`getHeroTilesForAllVibes(limit = 14)`). */
export const HERO_TILES_MAX = 14;
/** The home row shows 8; a few spares are allowed so the owner can swap the order. */
export const FEATURED_MAX = 16;
const MAX: Record<FeaturedPlacement, number> = {
  home_featured: FEATURED_MAX,
  hero_tiles: HERO_TILES_MAX,
};

export interface SlotProduct {
  productId: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "archived";
  hasCutout: boolean;
  /** The cutout is a generated stand-in, not real photography. */
  placeholderCutout: boolean;
}

export interface VibeSlots {
  id: string;
  slug: string;
  name: string;
  featured: SlotProduct[];
  hero: SlotProduct[];
  heroStats: {
    needed: number;
    /** Tiles the storefront shows for this vibe right now (curated, or the fallback). */
    effective: number;
    /** No curated tile has a cutout, so the storefront uses the vibe's products that have one. */
    usingFallback: boolean;
    /** Of the effective tiles, how many use a placeholder cutout. */
    placeholderTiles: number;
    warning: boolean;
  };
}

export interface FeaturedAdminData {
  vibes: VibeSlots[];
  /** Every non-archived product, for the "add" pickers. */
  candidates: SlotProduct[];
}

async function productInfo(db: DbClient, ids?: readonly string[]): Promise<Map<string, SlotProduct>> {
  if (ids && ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      status: products.status,
    })
    .from(products)
    .where(ids ? inArray(products.id, [...ids]) : ne(products.status, "archived"))
    .orderBy(asc(products.name));
  if (rows.length === 0) return new Map();
  const cutouts = await db
    .select({
      productId: productImages.productId,
      isPlaceholder: productImages.isPlaceholder,
    })
    .from(productImages)
    .where(
      and(
        eq(productImages.kind, "cutout"),
        inArray(productImages.productId, rows.map((r) => r.id)),
      ),
    );
  const hasCutout = new Set(cutouts.map((c) => c.productId));
  const realCutout = new Set(cutouts.filter((c) => !c.isPlaceholder).map((c) => c.productId));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        productId: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        hasCutout: hasCutout.has(r.id),
        placeholderCutout: hasCutout.has(r.id) && !realCutout.has(r.id),
      },
    ]),
  );
}

export async function getFeaturedAdmin(db: DbClient, opts: { now?: Date } = {}): Promise<FeaturedAdminData> {
  const [vibeRows, slotRows, info, tiles] = await Promise.all([
    db.select().from(vibes).orderBy(asc(vibes.sort), asc(vibes.name)),
    db
      .select()
      .from(featuredSlots)
      .orderBy(asc(featuredSlots.rank), asc(featuredSlots.createdAt), asc(featuredSlots.id)),
    productInfo(db),
    // What the storefront would render for the hero, so the warning matches reality.
    getHeroTilesForAllVibes(db, 50, { now: opts.now }),
  ]);
  // Slots may point at products that are now archived: still list them (flagged) so they can be removed.
  const missing = slotRows.map((s) => s.productId).filter((id) => !info.has(id));
  if (missing.length) {
    for (const [id, p] of await productInfo(db, missing)) info.set(id, p);
  }
  const placeholderCutoutOf = (productId: string) => info.get(productId)?.placeholderCutout ?? false;

  return {
    candidates: [...info.values()].filter((p) => p.status !== "archived"),
    vibes: vibeRows.map((v) => {
      const mine = (placement: FeaturedPlacement) =>
        slotRows
          .filter((s) => s.vibeId === v.id && s.placement === placement)
          .map((s) => info.get(s.productId))
          .filter((p): p is SlotProduct => p !== undefined);
      const hero = mine("hero_tiles");
      const effectiveTiles = tiles[v.slug] ?? [];
      const curatedWithCutout = hero.filter((p) => p.hasCutout && p.status === "active").length;
      return {
        id: v.id,
        slug: v.slug,
        name: v.name,
        featured: mine("home_featured"),
        hero,
        heroStats: {
          needed: HERO_TILES_MIN,
          effective: effectiveTiles.length,
          usingFallback: curatedWithCutout === 0,
          placeholderTiles: effectiveTiles.filter((t) => placeholderCutoutOf(t.productId)).length,
          warning: effectiveTiles.length < HERO_TILES_MIN,
        },
      };
    }),
  };
}

const setSlotsSchema = z.object({
  vibeId: z.uuid(),
  placement: z.enum(FEATURED_PLACEMENTS),
  productIds: z.array(z.uuid()),
});

/**
 * Replaces one vibe's curated list for a placement; ranks become 0..n-1 in the given order.
 * Products must exist and not be archived.
 */
export async function setFeaturedSlots(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<{ productIds: string[] }> {
  assertCan(actor.role, "content:manage");
  const input = setSlotsSchema.parse(raw);
  if (new Set(input.productIds).size !== input.productIds.length) {
    throw new AdminInputError("A product is listed twice");
  }
  if (input.productIds.length > MAX[input.placement]) {
    throw new AdminInputError(`At most ${MAX[input.placement]} products can be added here`);
  }
  return db.transaction(async (tx) => {
    const [vibe] = await tx.select().from(vibes).where(eq(vibes.id, input.vibeId)).for("update");
    if (!vibe) throw new AdminInputError("Vibe not found");
    if (input.productIds.length) {
      const found = await tx
        .select({ id: products.id, status: products.status })
        .from(products)
        .where(inArray(products.id, input.productIds));
      if (found.length !== input.productIds.length) throw new AdminInputError("A product no longer exists");
      if (found.some((p) => p.status === "archived")) {
        throw new AdminInputError("Archived products cannot be featured");
      }
    }
    const before = await tx
      .select({ productId: featuredSlots.productId })
      .from(featuredSlots)
      .where(and(eq(featuredSlots.vibeId, input.vibeId), eq(featuredSlots.placement, input.placement)))
      .orderBy(asc(featuredSlots.rank), asc(featuredSlots.createdAt), asc(featuredSlots.id));
    await tx
      .delete(featuredSlots)
      .where(and(eq(featuredSlots.vibeId, input.vibeId), eq(featuredSlots.placement, input.placement)));
    if (input.productIds.length) {
      await tx.insert(featuredSlots).values(
        input.productIds.map((productId, rank) => ({
          vibeId: input.vibeId,
          placement: input.placement,
          productId,
          rank,
        })),
      );
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: input.placement === "hero_tiles" ? "hero_tiles.set" : "featured.set",
      entity: "vibe",
      entityId: input.vibeId,
      diff: { vibe: vibe.slug, placement: input.placement, from: before.map((b) => b.productId), to: input.productIds },
      ip: actor.ip,
    });
    return { productIds: input.productIds };
  });
}
