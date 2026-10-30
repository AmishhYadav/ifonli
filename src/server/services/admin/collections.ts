import "server-only";

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { CatalogInvalidation } from "@/server/cache/tags";
import { assertCan } from "@/server/auth/permissions";
import { productTypes, productVibes, products, vibes } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import type { DbClient } from "@/server/services/queries/shared";

import { diffFields } from "./product-schema";
import { AdminInputError, type AdminActor } from "./products";

const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null));

export const vibeCopySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  description: text(600),
  heroCopy: text(300),
  seoTitle: text(200),
  seoDesc: text(400),
});

export const typeCopySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  definition: text(800),
  seoTitle: text(200),
  seoDesc: text(400),
  active: z.boolean(),
});

export interface VibeAdminRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  heroCopy: string | null;
  seoTitle: string | null;
  seoDesc: string | null;
  /** Products of this vibe with a featured rank, best first. */
  featured: FeaturedProduct[];
  /** Other products of this vibe that could be featured. */
  candidates: FeaturedProduct[];
}

export interface FeaturedProduct {
  productId: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "archived";
}

export interface TypeAdminRow {
  id: string;
  slug: string;
  name: string;
  definition: string | null;
  seoTitle: string | null;
  seoDesc: string | null;
  active: boolean;
  productCount: number;
}

export async function getCollectionsAdmin(
  db: DbClient,
): Promise<{ vibes: VibeAdminRow[]; types: TypeAdminRow[] }> {
  const [vibeRows, typeRows, links, counts] = await Promise.all([
    db.select().from(vibes).orderBy(asc(vibes.sort), asc(vibes.name)),
    db.select().from(productTypes).orderBy(asc(productTypes.sort), asc(productTypes.name)),
    db
      .select({
        vibeId: productVibes.vibeId,
        rank: productVibes.featuredRank,
        productId: products.id,
        name: products.name,
        slug: products.slug,
        status: products.status,
      })
      .from(productVibes)
      .innerJoin(products, eq(productVibes.productId, products.id))
      .where(sql`${products.status} <> 'archived'`)
      .orderBy(asc(productVibes.featuredRank), asc(products.name)),
    db
      .select({ typeId: products.typeId, n: sql<number>`count(*)::int` })
      .from(products)
      .groupBy(products.typeId),
  ]);
  const countByType = new Map(counts.map((c) => [c.typeId, c.n]));
  return {
    vibes: vibeRows.map((v) => {
      const mine = links.filter((l) => l.vibeId === v.id);
      const toProduct = (l: (typeof mine)[number]): FeaturedProduct => ({
        productId: l.productId,
        name: l.name,
        slug: l.slug,
        status: l.status,
      });
      return {
        id: v.id,
        slug: v.slug,
        name: v.name,
        description: v.description,
        heroCopy: v.heroCopy,
        seoTitle: v.seoTitle,
        seoDesc: v.seoDesc,
        featured: mine.filter((l) => l.rank !== null).map(toProduct),
        candidates: mine.filter((l) => l.rank === null).map(toProduct),
      };
    }),
    types: typeRows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      definition: t.definition,
      seoTitle: t.seoTitle,
      seoDesc: t.seoDesc,
      active: t.active,
      productCount: countByType.get(t.id) ?? 0,
    })),
  };
}

export async function updateVibeCopy(
  db: DbClient,
  vibeId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<CatalogInvalidation> {
  assertCan(actor.role, "collection:update");
  const input = vibeCopySchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(vibes).where(eq(vibes.id, vibeId)).for("update");
    if (!before) throw new AdminInputError("Vibe not found");
    await tx.update(vibes).set(input).where(eq(vibes.id, vibeId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "vibe.update",
      entity: "vibe",
      entityId: vibeId,
      diff: diffFields(
        {
          name: before.name,
          description: before.description,
          heroCopy: before.heroCopy,
          seoTitle: before.seoTitle,
          seoDesc: before.seoDesc,
        },
        input,
      ),
      ip: actor.ip,
    });
    return { vibeSlugs: [before.slug] };
  });
}

export async function updateTypeCopy(
  db: DbClient,
  typeId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<CatalogInvalidation> {
  assertCan(actor.role, "collection:update");
  const input = typeCopySchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(productTypes)
      .where(eq(productTypes.id, typeId))
      .for("update");
    if (!before) throw new AdminInputError("Product type not found");
    await tx.update(productTypes).set(input).where(eq(productTypes.id, typeId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "product_type.update",
      entity: "product_type",
      entityId: typeId,
      diff: diffFields(
        {
          name: before.name,
          definition: before.definition,
          seoTitle: before.seoTitle,
          seoDesc: before.seoDesc,
          active: before.active,
        },
        input,
      ),
      ip: actor.ip,
    });
    // Deactivating a type hides its products everywhere: expire them (and `catalog`) too.
    if (before.active === input.active) return { typeSlugs: [before.slug] };
    const members = await tx
      .select({ id: products.id, slug: products.slug })
      .from(products)
      .where(eq(products.typeId, typeId));
    return {
      typeSlugs: [before.slug],
      productIds: members.map((m) => m.id),
      productSlugs: members.map((m) => m.slug),
    };
  });
}

/**
 * Sets the featured order of a vibe: products in `orderedProductIds` get ranks 0..n-1 in that order,
 * every other product of the vibe loses its rank. Products must already belong to the vibe.
 */
export async function setFeaturedOrder(
  db: DbClient,
  vibeId: string,
  orderedProductIds: readonly string[],
  actor: AdminActor,
): Promise<CatalogInvalidation> {
  assertCan(actor.role, "collection:update");
  const ids = z
    .array(z.uuid())
    .max(500)
    .parse([...orderedProductIds]);
  if (new Set(ids).size !== ids.length) throw new AdminInputError("A product is listed twice");
  return db.transaction(async (tx) => {
    const [vibe] = await tx.select().from(vibes).where(eq(vibes.id, vibeId)).for("update");
    if (!vibe) throw new AdminInputError("Vibe not found");
    const current = await tx
      .select({ productId: productVibes.productId, rank: productVibes.featuredRank })
      .from(productVibes)
      .where(eq(productVibes.vibeId, vibeId));
    const members = new Set(current.map((c) => c.productId));
    if (ids.some((id) => !members.has(id)))
      throw new AdminInputError("A product is not in this vibe");

    const before = current
      .filter((c) => c.rank !== null)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((c) => c.productId);

    // Clear all ranks of the vibe, then rank the given list.
    await tx
      .update(productVibes)
      .set({ featuredRank: null })
      .where(and(eq(productVibes.vibeId, vibeId), isNotNull(productVibes.featuredRank)));
    for (const [rank, productId] of ids.entries()) {
      await tx
        .update(productVibes)
        .set({ featuredRank: rank })
        .where(and(eq(productVibes.vibeId, vibeId), eq(productVibes.productId, productId)));
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "vibe.featured_order",
      entity: "vibe",
      entityId: vibeId,
      diff: { from: before, to: ids },
      ip: actor.ip,
    });
    const affected = [...new Set([...before, ...ids])];
    return {
      vibeSlugs: [vibe.slug],
      productIds: affected,
      productSlugs: affected.length
        ? (
            await tx
              .select({ slug: products.slug })
              .from(products)
              .where(inArray(products.id, affected))
          ).map((p) => p.slug)
        : [],
    };
  });
}
