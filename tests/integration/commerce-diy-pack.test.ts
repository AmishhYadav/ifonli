import { readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DIY_CHAIN_SKU, DIY_PARTS_TYPE_SLUG } from "@/lib/diy";
import { getDb } from "@/server/db";
import { cartItems, orderItems, productTypes, products, variants } from "@/server/db/schema";
import { addDiyPack, addItem, getCartView, removeItem, setQuantity } from "@/server/services/cart";
import { getCheckoutQuote } from "@/server/services/checkout";
import { createFromCart } from "@/server/services/orders";
import { listProducts } from "@/server/services/catalog";
import { searchProducts } from "@/server/services/search";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { checkoutForm, configureCommerce, makeCart, seedCommerceReference } from "./helpers/factories";
import { createSql } from "./helpers/db";

/**
 * DIY pack: 1 to 4 charms plus ONE free chain. The chain is a real price-0 product in the hidden "diy-parts" type:
 * the cart accepts it only through addDiyPack, it never outnumbers the charms, it is never listed, and the order
 * carries it as a line fulfilment can pack.
 */
const db = () => getDb();
let f: Fixture;
let chainVariant: string;

beforeEach(async () => {
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
  const [type] = await db()
    .insert(productTypes)
    .values({ slug: DIY_PARTS_TYPE_SLUG, name: "DIY parts", sort: 90, active: false })
    .returning();
  const [chain] = await db()
    .insert(products)
    .values({ slug: "diy-chain", name: "DIY chain", typeId: type!.id, status: "active", hsnCode: "7117", gstRateBp: 300 })
    .returning();
  const [v] = await db()
    .insert(variants)
    .values({ productId: chain!.id, sku: DIY_CHAIN_SKU, pricePaise: 0, mrpPaise: 0, stockOnHand: 50 })
    .returning();
  chainVariant = v!.id;
});

/** Extra charms (the fixture has three in stock), so a pack can reach its limit. */
async function moreCharms(n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const [p] = await db().insert(products).values({ slug: `extra-charm-${i}`, name: `Extra charm ${i}`, typeId: f.types.charms, status: "active" }).returning();
    const [v] = await db().insert(variants).values({ productId: p!.id, sku: `XC-${i}`, pricePaise: 5000, mrpPaise: 5000, stockOnHand: 5 }).returning();
    out.push(v!.id);
  }
  return out;
}

const linesOf = async (cartId: string) =>
  Object.fromEntries((await db().select().from(cartItems).where(eq(cartItems.cartId, cartId))).map((r) => [r.variantId, r.qty]));

describe("addDiyPack", () => {
  it("puts the charms and one free chain in the bag; the chain adds nothing to the price", async () => {
    const cart = await makeCart();
    const r = await addDiyPack(db(), cart.id, { variantIds: [f.variants.skull!, f.variants.spiky!] });
    expect(r.ok).toBe(true);
    expect(await linesOf(cart.id)).toEqual({ [chainVariant]: 1, [f.variants.skull!]: 1, [f.variants.spiky!]: 1 });

    const view = await getCartView(db(), cart.id);
    const chain = view.lines.find((l) => l.isDiyChain);
    expect(chain).toMatchObject({ productName: "DIY chain", qty: 1, unitPricePaise: 0, lineTotalPaise: 0 });
    expect(view.lines.filter((l) => !l.isDiyChain)).toHaveLength(2);
    expect(view.pricing.subtotalPaise).toBe(19900 + 24900);
  });

  it("a second pack makes it two chains, one per pack", async () => {
    const cart = await makeCart();
    await addDiyPack(db(), cart.id, { variantIds: [f.variants.skull!] });
    await addDiyPack(db(), cart.id, { variantIds: [f.variants.spiky!] });
    expect((await linesOf(cart.id))[chainVariant]).toBe(2);
  });

  it("takes 1 to 4 charms, no more, no fewer", async () => {
    const cart = await makeCart();
    expect(await addDiyPack(db(), cart.id, { variantIds: [] })).toMatchObject({ ok: false, code: "invalid_qty" });
    const five = [f.variants.skull!, f.variants.spiky!, f.variants.heartPink!, ...(await moreCharms(2))];
    expect(await addDiyPack(db(), cart.id, { variantIds: five })).toMatchObject({ ok: false, code: "invalid_qty" });
    expect(await addDiyPack(db(), cart.id, { variantIds: five.slice(0, 4) })).toMatchObject({ ok: true });
  });

  it("only charms go in a pack, and a rejected pack leaves the bag untouched", async () => {
    const cart = await makeCart();
    // cat-sticker is a 3D sticker, not a charm
    const r = await addDiyPack(db(), cart.id, { variantIds: [f.variants.skull!, f.variants.cat!] });
    expect(r).toMatchObject({ ok: false, code: "unavailable" });
    expect(await linesOf(cart.id)).toEqual({});
  });

  it("is all or nothing when a charm is sold out", async () => {
    const cart = await makeCart();
    const r = await addDiyPack(db(), cart.id, { variantIds: [f.variants.skull!, f.variants.heartRed!] }); // Red has 0 stock
    expect(r.ok).toBe(false);
    expect(await linesOf(cart.id)).toEqual({});
  });

  it("says packs are unavailable when the chain does not exist or is sold out", async () => {
    await db().update(variants).set({ stockOnHand: 0 }).where(eq(variants.id, chainVariant));
    const cart = await makeCart();
    expect(await addDiyPack(db(), cart.id, { variantIds: [f.variants.skull!] })).toMatchObject({ ok: false, code: "sold_out" });
    expect(await linesOf(cart.id)).toEqual({});
    await db().delete(variants).where(eq(variants.id, chainVariant));
    expect(await addDiyPack(db(), cart.id, { variantIds: [f.variants.skull!] })).toMatchObject({ ok: false, code: "unavailable" });
  });
});

describe("the chain cannot be bought on its own", () => {
  it("addItem and setQuantity refuse to add it", async () => {
    const cart = await makeCart();
    expect(await addItem(db(), cart.id, { variantId: chainVariant, qty: 1 })).toMatchObject({ ok: false, code: "unavailable" });
    await addDiyPack(db(), cart.id, { variantIds: [f.variants.skull!] });
    expect(await setQuantity(db(), cart.id, { variantId: chainVariant, qty: 3 })).toMatchObject({ ok: false, code: "unavailable" });
    expect((await linesOf(cart.id))[chainVariant]).toBe(1);
  });

  it("the chain goes when the last charm does, and never outnumbers the charms", async () => {
    const cart = await makeCart();
    await addDiyPack(db(), cart.id, { variantIds: [f.variants.skull!] });
    await addDiyPack(db(), cart.id, { variantIds: [f.variants.spiky!] });
    await removeItem(db(), cart.id, { variantId: f.variants.spiky! });
    // 2 chains, 1 charm left: the view caps the chain to the one pack that is left
    const view = await getCartView(db(), cart.id);
    expect(view.lines.find((l) => l.isDiyChain)?.qty).toBe(1);
    expect((await linesOf(cart.id))[chainVariant]).toBe(1);

    await removeItem(db(), cart.id, { variantId: f.variants.skull! });
    const empty = await getCartView(db(), cart.id);
    expect(empty.lines).toEqual([]);
    expect(await linesOf(cart.id)).toEqual({});
  });

  it("a lone chain (crafted into the cart) is dropped", async () => {
    const cart = await makeCart([{ variantId: chainVariant, qty: 1 }]);
    expect((await getCartView(db(), cart.id)).lines).toEqual([]);
  });
});

describe("a pack through checkout and into the order", () => {
  it("prices the pack at the sum of its charms and keeps a free chain line on the order", async () => {
    const cart = await makeCart();
    await addDiyPack(db(), cart.id, { variantIds: [f.variants.skull!, f.variants.spiky!] }); // 199 + 249
    const quote = await getCheckoutQuote(db(), cart.id, { pincode: "400001" });
    expect(quote.pricing.subtotalPaise).toBe(44800);
    expect(quote.canPlaceOrder).toBe(true);

    const placed = await createFromCart(db(), { cartToken: cart.token, form: checkoutForm({ paymentMethod: "cod" }) });
    if (!placed.ok) throw new Error(`${placed.error.code}: ${placed.error.message}`);
    const lines = await db().select().from(orderItems).where(eq(orderItems.orderId, placed.order.orderId));
    const chain = lines.find((l) => l.sku === DIY_CHAIN_SKU);
    expect(chain).toMatchObject({ productName: "DIY chain", qty: 1, unitPricePaise: 0, lineTotalPaise: 0, taxPaise: 0 });
    expect(lines).toHaveLength(3);
    expect(lines.reduce((n, l) => n + l.lineTotalPaise, 0)).toBe(44800);
  });
});

describe("the chain stays out of the shop window", () => {
  it("is in no listing, no search result and no type facet, though the cart can hold it", async () => {
    const all = await listProducts(db(), {});
    expect(all.items.map((p) => p.slug)).not.toContain("diy-chain");
    expect(all.facets.types.map((t) => t.slug)).not.toContain(DIY_PARTS_TYPE_SLUG);
    const found = await searchProducts(db(), { q: "chain" });
    expect(found.items.map((p) => p.slug)).not.toContain("diy-chain");
  });
});

describe("migration 0008: the DIY chain", () => {
  const sql = createSql();
  afterAll(() => sql.end());
  const statements = readFileSync(path.resolve(process.cwd(), "drizzle/0008_diy_chain.sql"), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  const run = async () => {
    for (const s of statements) await sql.unsafe(s);
  };

  it("creates the hidden type, the free chain with stock, ledger row and photo, and is idempotent", async () => {
    await db().delete(variants).where(eq(variants.id, chainVariant));
    await db().delete(products).where(eq(products.slug, "diy-chain"));
    await db().delete(productTypes).where(eq(productTypes.slug, DIY_PARTS_TYPE_SLUG));

    await run();
    await run();

    const rows = await sql<{ active: boolean; price: number; mrp: number; stock: number; status: string; path: string; moves: number }[]>`
      SELECT t.active, v.price_paise::int AS price, v.mrp_paise::int AS mrp, v.stock_on_hand AS stock, p.status, i.path,
        (SELECT count(*)::int FROM inventory_movements m WHERE m.variant_id = v.id) AS moves
      FROM variants v
      JOIN products p ON p.id = v.product_id
      JOIN product_types t ON t.id = p.type_id
      JOIN product_images i ON i.product_id = p.id
      WHERE v.sku = ${DIY_CHAIN_SKU}`;
    expect(rows).toEqual([{ active: false, price: 0, mrp: 0, stock: 500, status: "active", path: "/diy/chain.png", moves: 1 }]);
  });
});
