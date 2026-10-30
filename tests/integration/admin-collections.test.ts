import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { getDb } from "@/server/db";
import { adminAuditLog, productTypes, productVibes, user, vibes } from "@/server/db/schema";
import {
  getCollectionsAdmin,
  setFeaturedOrder,
  updateTypeCopy,
  updateVibeCopy,
} from "@/server/services/admin/collections";
import { AdminInputError } from "@/server/services/admin/products";

import { seedCatalogFixture } from "./catalog-fixture";

const owner = { id: "owner-1", role: "owner" };
const fulfilment = { id: "ful-1", role: "fulfilment" };

async function setup() {
  await getDb()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" },
      { id: "ful-1", name: "Packer", email: "ful@example.com", role: "fulfilment" },
    ]);
  return seedCatalogFixture();
}

describe("admin collections", () => {
  it("lists vibes with featured products in rank order and candidates", async () => {
    const f = await setup();
    const data = await getCollectionsAdmin(getDb());
    const gothic = data.vibes.find((v) => v.slug === "gothic")!;
    expect(gothic.featured.map((p) => p.slug)).toEqual(["skull-charm", "ghost-sticker"]);
    expect(data.types.find((t) => t.slug === "charms")?.productCount).toBeGreaterThan(0);
    expect(f.vibes.gothic).toBe(gothic.id);
  });

  it("updates vibe copy, audits the diff and reports the vibe to invalidate", async () => {
    const f = await setup();
    const inv = await updateVibeCopy(
      getDb(),
      f.vibes.cute,
      { name: "Cute!", description: " Soft and sweet ", heroCopy: "", seoTitle: "", seoDesc: "" },
      owner,
    );
    expect(inv).toEqual({ vibeSlugs: ["cute"] });
    const [row] = await getDb().select().from(vibes).where(eq(vibes.id, f.vibes.cute));
    expect(row).toMatchObject({ name: "Cute!", description: "Soft and sweet", heroCopy: null });
    const [audit] = await getDb()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "vibe.update"));
    expect(audit?.diff).toMatchObject({ name: { from: "Cute", to: "Cute!" } });
    await expect(
      updateVibeCopy(getDb(), f.vibes.cute, { name: " " }, owner),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(updateVibeCopy(getDb(), f.vibes.cute, { name: "X" }, fulfilment)).rejects.toThrow(
      /Forbidden/,
    );
  });

  it("updates type copy; toggling active expires the type's products too", async () => {
    const f = await setup();
    const same = await updateTypeCopy(
      getDb(),
      f.types.charms,
      { name: "Charms", definition: "Small things", active: true },
      owner,
    );
    expect(same).toEqual({ typeSlugs: ["charms"] });
    const off = await updateTypeCopy(
      getDb(),
      f.types.charms,
      { name: "Charms", active: false },
      owner,
    );
    expect(off.productIds?.length).toBeGreaterThan(0);
    expect(
      (await getDb().select().from(productTypes).where(eq(productTypes.id, f.types.charms)))[0]
        ?.active,
    ).toBe(false);
  });

  it("reorders featured products: listed get ranks 0..n-1, others lose theirs, non-members rejected", async () => {
    const f = await setup();
    const gothicBefore = (await getCollectionsAdmin(getDb())).vibes.find(
      (v) => v.slug === "gothic",
    )!;
    const [first, second] = gothicBefore.featured;
    const inv = await setFeaturedOrder(
      getDb(),
      f.vibes.gothic,
      [second!.productId, first!.productId],
      owner,
    );
    expect(inv.vibeSlugs).toEqual(["gothic"]);
    expect(inv.productIds).toEqual(expect.arrayContaining([first!.productId, second!.productId]));
    const after = (await getCollectionsAdmin(getDb())).vibes.find((v) => v.slug === "gothic")!;
    expect(after.featured.map((p) => p.productId)).toEqual([second!.productId, first!.productId]);

    // Remove one: it becomes a candidate again.
    await setFeaturedOrder(getDb(), f.vibes.gothic, [second!.productId], owner);
    const trimmed = (await getCollectionsAdmin(getDb())).vibes.find((v) => v.slug === "gothic")!;
    expect(trimmed.featured).toHaveLength(1);
    expect(trimmed.candidates.map((p) => p.productId)).toContain(first!.productId);

    // Ranks in other vibes are untouched.
    const bold = await getDb()
      .select()
      .from(productVibes)
      .where(eq(productVibes.vibeId, f.vibes.bold));
    expect(bold.some((r) => r.featuredRank !== null)).toBe(true);

    const cuteProduct = (await getCollectionsAdmin(getDb())).vibes.find((v) => v.slug === "cute")!
      .featured[0]!;
    await expect(
      setFeaturedOrder(getDb(), f.vibes.gothic, [cuteProduct.productId], owner),
    ).rejects.toBeInstanceOf(AdminInputError);
    await expect(
      setFeaturedOrder(getDb(), f.vibes.gothic, [second!.productId, second!.productId], owner),
    ).rejects.toBeInstanceOf(AdminInputError);
    await expect(setFeaturedOrder(getDb(), f.vibes.gothic, [], fulfilment)).rejects.toThrow(
      /Forbidden/,
    );
  });
});
