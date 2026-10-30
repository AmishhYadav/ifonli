import { getDb } from "@/server/db";
import {
  featuredSlots,
  orders,
  productImages,
  productOptionValues,
  productOptions,
  productTypes,
  productVibes,
  products,
  stockReservations,
  variants,
  vibes,
} from "@/server/db/schema";

/**
 * Small fixture catalogue, independent of the dev seed.
 *
 * vibes: cute(1) bold(2) gothic(3)      types: charms(1) 3d-stickers(2) retired(inactive)
 * Visible products (createdAt oldest -> newest):
 *   skull-charm   charms    gothic r0, bold r2   one variant   199.00 (mrp 249)  stock 10  India   photo+cutout
 *   heart-charm   charms    cute r0              Pink 149 stock 5 / Red 179 stock 0   India   cutout only
 *   cat-sticker   stickers  cute r1              99.00  stock 3 (low)   Japan   photo only
 *   ghost-sticker stickers  gothic r1            129.00 stock 20        India   no images
 *   spiky-charm   charms    bold r0              249.00 stock 7         India   photo+cutout
 * Hidden: draft-thing (draft), retired-product (inactive type), no-variants, inactive-variant-only.
 */
export interface Fixture {
  vibes: Record<"cute" | "bold" | "gothic", string>;
  types: Record<"charms" | "stickers" | "retired", string>;
  products: Record<string, string>;
  variants: Record<string, string>;
}

const t = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

export async function seedCatalogFixture(): Promise<Fixture> {
  const db = getDb();
  const vibeRows = await db
    .insert(vibes)
    .values([
      { slug: "cute", name: "Cute", sort: 1 },
      { slug: "bold", name: "Bold", sort: 2 },
      { slug: "gothic", name: "Gothic", sort: 3 },
    ])
    .returning();
  const typeRows = await db
    .insert(productTypes)
    .values([
      { slug: "charms", name: "Charms", sort: 1 },
      { slug: "3d-stickers", name: "3D Stickers", sort: 2 },
      { slug: "retired", name: "Retired", sort: 3, active: false },
    ])
    .returning();
  const v = Object.fromEntries(vibeRows.map((r) => [r.slug, r.id])) as Fixture["vibes"];
  const ty = {
    charms: typeRows.find((r) => r.slug === "charms")!.id,
    stickers: typeRows.find((r) => r.slug === "3d-stickers")!.id,
    retired: typeRows.find((r) => r.slug === "retired")!.id,
  };

  const out: Fixture = { vibes: v, types: ty, products: {}, variants: {} };

  async function product(
    slug: string,
    name: string,
    typeId: string,
    minutesAgo: number,
    extra: Partial<typeof products.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(products)
      .values({
        slug,
        name,
        typeId,
        status: "active",
        countryOfOrigin: "India",
        descriptionMd: `${name} description`,
        createdAt: t(minutesAgo),
        ...extra,
      })
      .returning();
    out.products[slug] = row!.id;
    return row!.id;
  }
  async function variant(
    key: string,
    productId: string,
    over: Partial<typeof variants.$inferInsert> & { sku: string },
  ) {
    const [row] = await db
      .insert(variants)
      .values({ productId, pricePaise: 10000, mrpPaise: 10000, stockOnHand: 5, ...over })
      .returning();
    out.variants[key] = row!.id;
    return row!.id;
  }
  async function vibe(productId: string, slug: keyof Fixture["vibes"], rank: number | null) {
    await db.insert(productVibes).values({ productId, vibeId: v[slug], featuredRank: rank });
  }
  async function image(productId: string, kind: "photo" | "cutout", name: string) {
    await db.insert(productImages).values({
      productId,
      kind,
      path: `/placeholders/cutouts/${name}-${kind}.svg`,
      alt: `${name} ${kind}`,
      width: 512,
      height: 512,
    });
  }

  const skull = await product("skull-charm", "Skull Charm", ty.charms, 50, {
    descriptionMd: "A grinning skull for dramatic days.",
    netQuantity: "1 piece",
    dimensions: "2 cm",
    hsnCode: "7117",
    gstRateBp: 300,
  });
  await variant("skull", skull, { sku: "SK-1", pricePaise: 19900, mrpPaise: 24900, stockOnHand: 10 });
  await vibe(skull, "gothic", 0);
  await vibe(skull, "bold", 2);
  await image(skull, "photo", "skull");
  await image(skull, "cutout", "skull");

  const heart = await product("heart-charm", "Heart Charm", ty.charms, 40);
  const [colour] = await db
    .insert(productOptions)
    .values({ productId: heart, name: "Colour", position: 0 })
    .returning();
  const [pink, red] = await db
    .insert(productOptionValues)
    .values([
      { optionId: colour!.id, value: "Pink", swatchHex: "#FF5C8A", position: 0 },
      { optionId: colour!.id, value: "Red", swatchHex: "#E5243B", position: 1 },
    ])
    .returning();
  await variant("heartPink", heart, {
    sku: "HT-PINK",
    title: "Pink",
    optionValueIds: [pink!.id],
    pricePaise: 14900,
    mrpPaise: 14900,
    stockOnHand: 5,
    position: 0,
  });
  await variant("heartRed", heart, {
    sku: "HT-RED",
    title: "Red",
    optionValueIds: [red!.id],
    pricePaise: 17900,
    mrpPaise: 19900,
    stockOnHand: 0,
    position: 1,
  });
  await vibe(heart, "cute", 0);
  await image(heart, "cutout", "heart");

  const cat = await product("cat-sticker", "Cat Sticker", ty.stickers, 30, { countryOfOrigin: "Japan" });
  await variant("cat", cat, { sku: "CT-1", pricePaise: 9900, mrpPaise: 9900, stockOnHand: 3 });
  await vibe(cat, "cute", 1);
  await image(cat, "photo", "cat");

  const ghost = await product("ghost-sticker", "Ghost Sticker", ty.stickers, 20);
  await variant("ghost", ghost, { sku: "GH-1", pricePaise: 12900, mrpPaise: 12900, stockOnHand: 20 });
  await vibe(ghost, "gothic", 1);

  const spiky = await product("spiky-charm", "Spiky Charm", ty.charms, 10);
  await variant("spiky", spiky, { sku: "SP-1", pricePaise: 24900, mrpPaise: 24900, stockOnHand: 7 });
  await vibe(spiky, "bold", 0);
  await image(spiky, "photo", "spiky");
  await image(spiky, "cutout", "spiky");

  // ---- hidden
  const draft = await product("draft-thing", "Draft Thing", ty.charms, 5, { status: "draft" });
  await variant("draft", draft, { sku: "DR-1", stockOnHand: 50 });
  await vibe(draft, "cute", 5);
  const retired = await product("retired-product", "Retired Product", ty.retired, 5);
  await variant("retired", retired, { sku: "RT-1", stockOnHand: 50 });
  await vibe(retired, "cute", 6);
  const noVariants = await product("no-variants", "No Variants", ty.charms, 5);
  await vibe(noVariants, "cute", 7);
  const inactiveOnly = await product("inactive-variant-only", "Inactive Variant Only", ty.charms, 5);
  await variant("inactiveOnly", inactiveOnly, { sku: "IN-1", active: false, stockOnHand: 50 });
  await vibe(inactiveOnly, "cute", 8);

  return out;
}

export async function makeOrder() {
  const n = Math.random().toString(36).slice(2, 10);
  const [row] = await getDb()
    .insert(orders)
    .values({
      ref: `IFO-T-${n}`,
      email: "buyer@example.com",
      paymentMethod: "razorpay",
      subtotalPaise: 100,
      totalPaise: 100,
      shippingAddress: {},
      idempotencyKey: `idem-${n}`,
    })
    .returning();
  return row!;
}

export async function reserve(variantId: string, qty: number, expiresInMinutes: number) {
  const order = await makeOrder();
  await getDb()
    .insert(stockReservations)
    .values({
      orderId: order.id,
      variantId,
      qty,
      expiresAt: new Date(Date.now() + expiresInMinutes * 60_000),
      status: "active",
    });
}

export async function addSlot(
  vibeId: string,
  placement: "home_featured" | "hero_tiles",
  productId: string,
  rank: number,
) {
  await getDb().insert(featuredSlots).values({ vibeId, placement, productId, rank });
}
