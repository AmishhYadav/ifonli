/**
 * Replaces the whole catalogue with the real products in content/store-values/catalogue.json
 * (from Charm_Product_Catalogue_Updated.docx). Every other product is deleted. Idempotent: a second
 * run creates nothing and rewrites only the image rows and featured sets.
 *
 *   pnpm exec tsx --conditions=react-server scripts/store-values/apply-catalogue.ts
 *   ... --allow-remote      (required for any database that is not on this machine)
 *
 * Products go through createProduct (acting as owner@ifonli.local), stock through the ledger. Images are
 * the files in public/products/ (<slug>-cutout.png and <slug>-v3-1..6.jpg: themed, plain, back, side, top,
 * on a string; only the views that exist), stored as site paths.
 * Next's "use cache" entries cannot be expired from a script: restart `next dev` to see the change.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";

import { DIY_CHAIN_PRODUCT_SLUG } from "../../src/lib/diy";
import { requireLocalOrAllowRemote } from "../db-guard";

config({ path: ".env.local" });
config();

requireLocalOrAllowRemote(
  "apply-catalogue",
  "delete every existing product and replace the catalogue",
);

const OWNER_EMAIL = "owner@ifonli.local";
const TYPE_SLUG = "charms";
const BACKDROP: Record<string, string> = {
  gothic: "deep violet",
  bold: "dark wine red",
  cute: "soft blush pink",
  funky: "warm cream-gold",
};

interface ProductEntry {
  slug: string;
  name: string;
  descriptionMd: string;
  vibe: string;
  sku: string;
  price: number;
  stock: number;
  weightG: number;
}

async function main() {
  const catalogue = JSON.parse(
    readFileSync(path.join(process.cwd(), "content/store-values/catalogue.json"), "utf8"),
  ) as { products: ProductEntry[] };
  const entries = catalogue.products;
  const slugs = entries.map((p) => p.slug);

  const { eq, inArray, notInArray, asc } = await import("drizzle-orm");
  const { getDb } = await import("../../src/server/db");
  const { products, productTypes, productImages, productVibes, vibes, user, variants, inventoryMovements } =
    await import("../../src/server/db/schema");
  const { createProduct } = await import("../../src/server/services/admin/products");
  const { setFeaturedSlots } = await import("../../src/server/services/admin/featured");
  const sharp = (await import("sharp")).default;
  const db = getDb();

  const [owner] = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.email, OWNER_EMAIL));
  if (!owner)
    throw new Error(`Staff account ${OWNER_EMAIL} not found. Run scripts/create-admin.ts first.`);
  const actor = { id: owner.id, role: owner.role, ip: null };

  const [type] = await db.select().from(productTypes).where(eq(productTypes.slug, TYPE_SLUG));
  if (!type) throw new Error(`Product type "${TYPE_SLUG}" not found`);
  const vibeRows = await db.select().from(vibes).orderBy(asc(vibes.sort));
  const vibeId = new Map(vibeRows.map((v) => [v.slug, v.id]));
  for (const p of entries)
    if (!vibeId.has(p.vibe)) throw new Error(`${p.slug}: unknown vibe ${p.vibe}`);

  // ---- 1. remove everything that is not in the new catalogue ----------------------------------
  // (the free chain of the DIY pack, made by migration 0008, is not a catalogue product and stays)
  const old = await db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(notInArray(products.slug, [...slugs, DIY_CHAIN_PRODUCT_SLUG]));
  // No orders exist yet, so the old products' ledger rows are only the placeholder opening stock.
  await db.transaction(async (tx) => {
    const oldIds = old.map((o) => o.id);
    if (!oldIds.length) return;
    const oldVariants = await tx
      .select({ id: variants.id })
      .from(variants)
      .where(inArray(variants.productId, oldIds));
    if (oldVariants.length)
      await tx.delete(inventoryMovements).where(
        inArray(
          inventoryMovements.variantId,
          oldVariants.map((v) => v.id),
        ),
      );
    await tx.delete(products).where(inArray(products.id, oldIds));
  });
  console.log(`removed ${old.length} old products`);

  // ---- 2. create the new products --------------------------------------------------------------
  const existing = await db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(inArray(products.slug, slugs));
  const idBySlug = new Map(existing.map((p) => [p.slug, p.id]));
  let created = 0;
  for (const p of entries) {
    const existingId = idBySlug.get(p.slug);
    if (existingId) {
      // already created: refresh price and section (vibe) from the catalogue
      await db
        .update(variants)
        .set({ pricePaise: p.price * 100, mrpPaise: p.price * 100 })
        .where(eq(variants.productId, existingId));
      await db.delete(productVibes).where(eq(productVibes.productId, existingId));
      await db.insert(productVibes).values({
        productId: existingId,
        vibeId: vibeId.get(p.vibe)!,
        featuredRank: entries.filter((e) => e.vibe === p.vibe).indexOf(p),
      });
      continue;
    }
    const rank = entries.filter((e) => e.vibe === p.vibe).indexOf(p);
    const res = await createProduct(
      db,
      {
        name: p.name,
        slug: p.slug,
        descriptionMd: p.descriptionMd,
        typeId: type.id,
        status: "active",
        isKit: false,
        seoTitle: p.name,
        seoDesc: p.descriptionMd.split(/(?<=\.)\s/)[0],
        hsnCode: "7117",
        gstRateBp: 300,
        countryOfOrigin: "India",
        netQuantity: "1 piece",
        dimensions: null,
        manufacturerOverride: null,
        vibes: [{ vibeId: vibeId.get(p.vibe)!, featuredRank: rank }],
        options: [],
        variants: [
          {
            sku: p.sku,
            title: "Default",
            optionValues: [],
            pricePaise: p.price * 100,
            mrpPaise: p.price * 100,
            weightG: p.weightG,
            lowStockThreshold: null,
            active: true,
            initialStock: p.stock,
          },
        ],
      },
      actor,
    );
    idBySlug.set(p.slug, res.id);
    created++;
  }
  console.log(`created ${created} products`);

  // ---- 3. images (site paths under /products) ---------------------------------------------------
  for (const p of entries) {
    const id = idBySlug.get(p.slug)!;
    const views = ["themed", "plain background", "back", "side", "top", "on a string"];
    const files = [
      {
        kind: "photo" as const,
        file: `${p.slug}-cutout.png`,
        alt: `${p.name} charm on a transparent background`,
        position: 99,
        cutout: true,
      },
      ...views.flatMap((view, i) =>
        existsSync(path.join(process.cwd(), "public/products", `${p.slug}-v3-${i + 1}.jpg`))
          ? [
              {
                kind: "photo" as const,
                file: `${p.slug}-v3-${i + 1}.jpg`,
                alt: `${p.name} charm, ${view} view`,
                position: 0,
                cutout: false,
              },
            ]
          : [],
      ),
    ].map((f, _i, all) => ({
      ...f,
      kind: f.cutout ? ("cutout" as const) : f.kind,
      position: f.cutout ? 99 : all.filter((o) => !o.cutout).indexOf(f),
    }));
    await db.delete(productImages).where(eq(productImages.productId, id));
    for (const f of files) {
      const meta = await sharp(path.join(process.cwd(), "public/products", f.file)).metadata();
      await db.insert(productImages).values({
        productId: id,
        kind: f.kind,
        path: `/products/${f.file}`,
        alt: f.alt,
        width: meta.width ?? null,
        height: meta.height ?? null,
        position: f.position,
        isPlaceholder: false,
      });
    }
  }

  // ---- 4. featured sets (hero tiles fall back to the vibe's products with a cutout) -------------
  for (const v of vibeRows) {
    const ids = entries.filter((e) => e.vibe === v.slug).map((e) => idBySlug.get(e.slug)!);
    await setFeaturedSlots(
      db,
      { vibeId: v.id, placement: "home_featured", productIds: ids },
      actor,
    );
  }

  const total = await db.select({ id: products.id }).from(products);
  const skus = await db.select({ sku: variants.sku }).from(variants);
  console.log(`done: ${total.length} products, ${skus.length} variants`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
