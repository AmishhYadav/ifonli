import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { catalogInvalidationTags, productSlugTag, productTag } from "@/server/cache/tags";
import { getDb } from "@/server/db";
import { productSlugRedirects, productTypes, products, user, variants } from "@/server/db/schema";
import {
  createProduct,
  duplicateProduct,
  setProductStatus,
  updateProduct,
  type AdminActor,
} from "@/server/services/admin/products";
import { getProductBySlug, getProductSlugRedirect } from "@/server/services/catalog";

const db = () => getDb();
const owner: AdminActor = { id: "owner-1", role: "owner" };

async function setup() {
  const [type] = await db().insert(productTypes).values({ slug: "charms", name: "Charms" }).returning();
  await db().insert(user).values({ id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" });
  return type!.id;
}

function input(typeId: string, slug: string, over: Record<string, unknown> = {}) {
  return {
    name: `Product ${slug}`,
    slug,
    descriptionMd: "x",
    typeId,
    status: "active",
    isKit: false,
    vibes: [],
    options: [],
    variants: [
      { sku: `sku-${slug}`, title: "Default", optionValues: [], pricePaise: 19900, mrpPaise: 24900, active: true, initialStock: 5 },
    ],
    ...over,
  };
}

/** Renames through the real update path; the existing variant is passed back by id so it is kept, not re-added. */
async function rename(productId: string, typeId: string, from: string, to: string, over: Record<string, unknown> = {}) {
  const [variant] = await db().select().from(variants).where(eq(variants.productId, productId));
  const base = input(typeId, from);
  return updateProduct(
    db(),
    productId,
    input(typeId, to, { variants: [{ ...base.variants[0], id: variant!.id, sku: variant!.sku }], ...over }),
    owner,
  );
}

const redirects = () => db().select().from(productSlugRedirects);
const target = (slug: string) => getProductSlugRedirect(db(), slug);

describe("product slug redirects", () => {
  it("records the old slug when a product is renamed and resolves it to the current slug", async () => {
    const typeId = await setup();
    const { id } = await createProduct(db(), input(typeId, "skull-charm"), owner);
    expect(await redirects()).toEqual([]); // nothing on create
    expect(await target("skull-charm")).toBeNull();

    await rename(id, typeId, "skull-charm", "skull-keyring");
    expect(await redirects()).toMatchObject([{ oldSlug: "skull-charm", productId: id }]);
    expect(await target("skull-charm")).toEqual({ slug: "skull-keyring", productId: id });
    // The live slug is never a redirect, and an unknown slug resolves to nothing.
    expect(await target("skull-keyring")).toBeNull();
    expect(await target("never-existed")).toBeNull();
  });

  it("does not record anything when a save leaves the slug unchanged", async () => {
    const typeId = await setup();
    const { id } = await createProduct(db(), input(typeId, "skull-charm"), owner);
    await rename(id, typeId, "skull-charm", "skull-charm", { name: "New name" });
    expect(await redirects()).toEqual([]);
  });

  it("collapses chains: a -> b -> c leaves both a and b pointing at the product, now c", async () => {
    const typeId = await setup();
    const { id } = await createProduct(db(), input(typeId, "a"), owner);
    await rename(id, typeId, "a", "b");
    await rename(id, typeId, "b", "c");
    expect((await redirects()).map((r) => r.oldSlug).sort()).toEqual(["a", "b"]);
    expect(await target("a")).toEqual({ slug: "c", productId: id });
    expect(await target("b")).toEqual({ slug: "c", productId: id });
  });

  it("a live slug wins: renaming back removes its own redirect, and a new or renamed product removes one it claims", async () => {
    const typeId = await setup();
    const a = await createProduct(db(), input(typeId, "a"), owner);
    await rename(a.id, typeId, "a", "b");
    // Back to "a": the redirect a -> product goes, b becomes the redirect.
    await rename(a.id, typeId, "b", "a");
    expect((await redirects()).map((r) => r.oldSlug)).toEqual(["b"]);
    expect(await target("a")).toBeNull();

    // A different product takes the redirect's slug "b" on create...
    const other = await createProduct(db(), input(typeId, "b"), owner);
    expect(await redirects()).toEqual([]);
    expect((await getProductBySlug(db(), "b"))?.id).toBe(other.id);

    // ...and by renaming onto it.
    await rename(a.id, typeId, "a", "z"); // redirect a
    const third = await createProduct(db(), input(typeId, "t"), owner);
    await rename(third.id, typeId, "t", "a");
    expect((await redirects()).map((r) => r.oldSlug).sort()).toEqual(["t"]);
    expect(await target("a")).toBeNull();
    expect(await target("t")).toEqual({ slug: "a", productId: third.id });
  });

  it("a duplicate (copy) claims its slug over a redirect", async () => {
    const typeId = await setup();
    const a = await createProduct(db(), input(typeId, "a"), owner);
    await rename(a.id, typeId, "a", "b");
    await db().insert(productSlugRedirects).values({ oldSlug: "b-copy", productId: a.id });
    const copy = await duplicateProduct(db(), a.id, owner);
    expect(copy.slug).toBe("b-copy");
    expect((await redirects()).map((r) => r.oldSlug)).toEqual(["a"]);
  });

  it("only redirects to a product shoppers can open (active, in an active type)", async () => {
    const typeId = await setup();
    const { id } = await createProduct(db(), input(typeId, "a"), owner);
    await rename(id, typeId, "a", "b");
    expect(await target("a")).not.toBeNull();
    await setProductStatus(db(), id, "archived", owner);
    expect(await target("a")).toBeNull();
    await setProductStatus(db(), id, "active", owner);
    expect(await target("a")).not.toBeNull();
    await db().update(productTypes).set({ active: false }).where(eq(productTypes.id, typeId));
    expect(await target("a")).toBeNull();
  });

  it("is removed with the product (ON DELETE CASCADE)", async () => {
    const typeId = await setup();
    // No opening stock: a stock ledger row would (rightly) block deleting the product.
    const noStock = input(typeId, "a");
    noStock.variants = [{ ...noStock.variants[0]!, initialStock: 0 }];
    const { id } = await createProduct(db(), noStock, owner);
    await rename(id, typeId, "a", "b");
    await db().delete(products).where(eq(products.id, id));
    expect(await redirects()).toEqual([]);
  });

  it("a rename expires the cache entries for the old slug, the new slug and the product", async () => {
    const typeId = await setup();
    const { id } = await createProduct(db(), input(typeId, "a"), owner);
    const out = await rename(id, typeId, "a", "b");
    const tags = catalogInvalidationTags(out.invalidation);
    // The cached redirect lookup is tagged with the old slug and (once resolved) the product.
    expect(tags).toEqual(expect.arrayContaining([productSlugTag("a"), productSlugTag("b"), productTag(id)]));
  });
});
