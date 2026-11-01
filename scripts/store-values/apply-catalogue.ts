/**
 * Turns the dev placeholder catalogue (32 `PH-` products) into a real-looking one, from
 * content/store-values/catalogue.json. Idempotent: a second run changes nothing and writes no
 * audit or ledger rows.
 *
 *   pnpm exec tsx --conditions=react-server scripts/store-values/apply-catalogue.ts
 *   ... --allow-remote      (required for any database that is not on this machine)
 *
 * Everything goes through the same services as the admin UI, acting as owner@ifonli.local:
 *   products / variants / SKUs / prices / legal fields   updateProduct          (audit: product.update)
 *   stock                                                adjustVariantStock     (ledger + audit: stock.adjust)
 *   images (cutout + 2 photos per product)               prepareImageUpload -> signed PUT ->
 *                                                        registerUploadedImage  (sharp re-encode, cutout alpha check)
 *   placeholder image rows                               deleteImage            (only rows with is_placeholder = true)
 *   home banners                                         prepareBannerImageUpload -> PUT -> verifyBannerImage -> createBanner / updateBanner
 *   featured sets and hero tiles                         setFeaturedSlots
 *
 * Images are rendered in memory with sharp from public/placeholders/cutouts/*.svg; nothing is written
 * to the repo. Next's "use cache" entries cannot be expired from a script: restart `next dev` (or
 * wait for cacheLife) to see the change on pages that were already rendered.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";

import { requireLocalOrAllowRemote } from "../db-guard";

config({ path: ".env.local" });
config();

requireLocalOrAllowRemote(
  "apply-catalogue",
  "rewrite the product catalogue, images, banners and featured sets",
);

const OWNER_EMAIL = "owner@ifonli.local";
/**
 * Non-placeholder images that an e2e test left on a catalogue product (heart-charm carried a
 * 1200 px red square cutout). They are replaced together with the placeholder rows.
 */
const STRAY_TEST_ALTS = ["Red test square"];
const STOCK_NOTE = "store values";
/** `--rerender-banner "<title>"` replaces that banner's image in place (the old object is dropped by updateBanner). */
const RERENDER_BANNER = process.argv[process.argv.indexOf("--rerender-banner") + 1] ?? null;
const rerenderIdx = process.argv.indexOf("--rerender-banner");

// ---------------------------------------------------------------------------------------------
// catalogue.json
// ---------------------------------------------------------------------------------------------

interface VariantEntry {
  title: string;
  sku: string;
  price: number;
  mrp: number;
  stock: number;
  weightG?: number;
}
interface ProductEntry {
  slug: string;
  name?: string;
  isKit?: boolean;
  descriptionMd: string;
  seoTitle: string;
  seoDesc: string;
  vibes: { vibe: string; rank: number | null }[];
  weightG: number;
  netQuantity: string;
  dimensions: string;
  hsnCode: string;
  gstRateBp: number;
  variants: VariantEntry[];
  image: {
    visual: string;
    bg1: [string, string];
    bg2: [string, string];
    sizeMm: number;
    tilt: number;
  };
}
interface BannerEntry {
  title: string;
  body: string;
  link: string;
  tile: { from: string; to: string };
  pieces: { slug: string; size: number; x: number; y: number; rotate: number }[];
}
interface Catalogue {
  products: ProductEntry[];
  artFiles: Record<string, string>;
  featuredSets: Record<string, string[]>;
  heroTiles: Record<string, string[]>;
  banners: BannerEntry[];
}

const TYPE_PREFIX: Record<string, string> = {
  charms: "CH",
  hippers: "HP",
  "3d-stickers": "ST",
  "diy-accessories": "DY",
};
const TYPE_RANGE_RUPEES: Record<string, [number, number]> = {
  charms: [149, 399],
  hippers: [199, 449],
  "3d-stickers": [99, 249],
  "diy-accessories": [299, 899],
};

function countWords(md: string): number {
  return md
    .replace(/[*_`#>-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

const trimOrNull = (s: string | null | undefined): string | null =>
  s && s.trim() ? s.trim() : null;

async function main() {
  const catalogue = JSON.parse(
    readFileSync(path.join(process.cwd(), "content/store-values/catalogue.json"), "utf8"),
  ) as Catalogue;

  const { eq, inArray, and, asc, sql } = await import("drizzle-orm");
  const { getDb } = await import("../../src/server/db");
  const schema = await import("../../src/server/db/schema");
  const {
    products,
    productTypes,
    productImages,
    vibes,
    featuredSlots,
    user,
    adminAuditLog,
    inventoryMovements,
  } = schema;
  const { getAdminProduct, updateProduct } =
    await import("../../src/server/services/admin/products");
  const { adjustVariantStock } = await import("../../src/server/services/admin/inventory");
  const { prepareImageUpload, registerUploadedImage, updateImageAlt, deleteImage } =
    await import("../../src/server/services/admin/product-images");
  const { listBanners, createBanner, updateBanner, prepareBannerImageUpload, verifyBannerImage } =
    await import("../../src/server/services/admin/banners");
  const { setFeaturedSlots, HERO_TILES_MIN } =
    await import("../../src/server/services/admin/featured");
  const { getLaunchReadiness } = await import("../../src/server/services/admin/launch");
  const { resolveImageUrl } = await import("../../src/server/services/media");
  const images = await import("./catalogue-images");

  const db = getDb();

  // ---- actor ---------------------------------------------------------------------------------
  const [owner] = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.email, OWNER_EMAIL));
  if (!owner)
    throw new Error(`Staff account ${OWNER_EMAIL} not found. Run scripts/create-admin.ts first.`);
  const actor = { id: owner.id, role: owner.role, ip: null };

  const countRows = async () => {
    const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(adminAuditLog);
    const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryMovements);
    const [i] = await db.select({ n: sql<number>`count(*)::int` }).from(productImages);
    return { audit: a!.n, movements: m!.n, images: i!.n };
  };
  const before = await countRows();

  // ---- validate the data file -------------------------------------------------------------------
  const problems: string[] = [];
  const slugs = catalogue.products.map((p) => p.slug);
  if (new Set(slugs).size !== slugs.length) problems.push("duplicate slugs in catalogue.json");
  const skuSeen = new Set<string>();
  for (const p of catalogue.products) {
    const words = countWords(p.descriptionMd);
    if (words < 60 || words > 120)
      problems.push(`${p.slug}: description has ${words} words (want 60-120)`);
    if (p.seoTitle.length > 60) problems.push(`${p.slug}: seoTitle ${p.seoTitle.length} > 60`);
    if (p.seoDesc.length > 155) problems.push(`${p.slug}: seoDesc ${p.seoDesc.length} > 155`);
    if (!catalogue.artFiles[p.slug]) problems.push(`${p.slug}: no art file`);
    for (const v of p.variants) {
      if (v.price > v.mrp) problems.push(`${p.slug}/${v.title}: price above MRP`);
      if (v.stock < 0) problems.push(`${p.slug}/${v.title}: negative stock`);
      if (skuSeen.has(v.sku)) problems.push(`duplicate SKU ${v.sku}`);
      skuSeen.add(v.sku);
      if (!/^IFO-(CH|HP|ST|DY)-[A-Z0-9-]+$/.test(v.sku))
        problems.push(`${p.slug}: SKU ${v.sku} does not match the scheme`);
    }
  }
  for (const [vibe, list] of Object.entries(catalogue.heroTiles)) {
    if (list.length < HERO_TILES_MIN)
      problems.push(`hero tiles for ${vibe}: ${list.length} < ${HERO_TILES_MIN}`);
  }
  for (const [vibe, list] of Object.entries(catalogue.featuredSets)) {
    if (list.length > 8) problems.push(`featured set for ${vibe}: ${list.length} > 8`);
  }
  for (const list of [
    ...Object.values(catalogue.heroTiles),
    ...Object.values(catalogue.featuredSets),
  ]) {
    for (const s of list) if (!slugs.includes(s)) problems.push(`unknown slug in a set: ${s}`);
  }
  if (problems.length) throw new Error("catalogue.json problems:\n  " + problems.join("\n  "));

  // ---- lookups ---------------------------------------------------------------------------------
  const vibeRows = await db.select().from(vibes).orderBy(asc(vibes.sort));
  const vibeIdBySlug = new Map(vibeRows.map((v) => [v.slug, v.id]));
  const typeRows = await db.select().from(productTypes);
  const typeSlugById = new Map(typeRows.map((t) => [t.id, t.slug]));
  const productRows = await db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(inArray(products.slug, slugs));
  const productIdBySlug = new Map(productRows.map((p) => [p.slug, p.id]));
  for (const s of slugs)
    if (!productIdBySlug.has(s)) throw new Error(`Product "${s}" not found in the database`);

  const log = {
    productsUpdated: 0,
    stockAdjustments: 0,
    imagesUploaded: 0,
    imagesRemoved: 0,
    altUpdated: 0,
    bannersCreated: 0,
    bannersUpdated: 0,
    setsChanged: 0,
  };

  // ---- 1. products, variants, legal fields -----------------------------------------------------
  for (const entry of catalogue.products) {
    const id = productIdBySlug.get(entry.slug)!;
    const detail = await getAdminProduct(db, id);
    if (!detail) throw new Error(`Product ${entry.slug} vanished`);
    const typeSlug = typeSlugById.get(detail.typeId) ?? "";
    const prefix = TYPE_PREFIX[typeSlug];
    const range = TYPE_RANGE_RUPEES[typeSlug];
    if (!prefix || !range) throw new Error(`${entry.slug}: unexpected product type "${typeSlug}"`);

    // Variants are matched by title; none may be added or dropped.
    const byTitle = new Map(entry.variants.map((v) => [v.title, v]));
    if (detail.variants.length !== entry.variants.length) {
      throw new Error(
        `${entry.slug}: DB has ${detail.variants.length} variants, catalogue.json ${entry.variants.length}`,
      );
    }
    for (const v of detail.variants) {
      if (!byTitle.has(v.title))
        throw new Error(`${entry.slug}: no catalogue entry for variant "${v.title}"`);
    }
    for (const v of entry.variants) {
      if (!v.sku.startsWith(`IFO-${prefix}-`))
        throw new Error(`${entry.slug}: SKU ${v.sku} should start IFO-${prefix}-`);
      if (v.price < range[0]) {
        throw new Error(`${entry.slug}: price ${v.price} below ${range[0]}`);
      }
    }

    const wantVibes = entry.vibes.map((v) => {
      const vibeId = vibeIdBySlug.get(v.vibe);
      if (!vibeId) throw new Error(`${entry.slug}: unknown vibe ${v.vibe}`);
      return { vibeId, featuredRank: v.rank };
    });
    const vibeKey = (list: { vibeId: string; featuredRank: number | null }[]) =>
      list
        .map((v) => `${v.vibeId}:${v.featuredRank ?? ""}`)
        .sort()
        .join("|");

    const want = {
      name: entry.name ?? detail.name,
      descriptionMd: entry.descriptionMd.trim(),
      isKit: entry.isKit ?? detail.isKit,
      seoTitle: entry.seoTitle,
      seoDesc: entry.seoDesc,
      hsnCode: entry.hsnCode,
      gstRateBp: entry.gstRateBp,
      countryOfOrigin: "India",
      netQuantity: entry.netQuantity,
      dimensions: entry.dimensions,
    };
    const changed =
      detail.name !== want.name ||
      trimOrNull(detail.descriptionMd) !== want.descriptionMd ||
      detail.isKit !== want.isKit ||
      trimOrNull(detail.seoTitle) !== want.seoTitle ||
      trimOrNull(detail.seoDesc) !== want.seoDesc ||
      trimOrNull(detail.hsnCode) !== want.hsnCode ||
      detail.gstRateBp !== want.gstRateBp ||
      trimOrNull(detail.countryOfOrigin) !== want.countryOfOrigin ||
      trimOrNull(detail.netQuantity) !== want.netQuantity ||
      trimOrNull(detail.dimensions) !== want.dimensions ||
      detail.manufacturerOverride !== null ||
      vibeKey(detail.vibes) !== vibeKey(wantVibes) ||
      detail.variants.some((v) => {
        const e = byTitle.get(v.title)!;
        return (
          v.sku !== e.sku ||
          v.pricePaise !== e.price * 100 ||
          v.mrpPaise !== e.mrp * 100 ||
          v.weightG !== (e.weightG ?? entry.weightG)
        );
      });

    if (changed) {
      await updateProduct(
        db,
        id,
        {
          ...want,
          slug: detail.slug,
          typeId: detail.typeId,
          status: detail.status,
          manufacturerOverride: null,
          vibes: wantVibes,
          options: detail.options.map((o) => ({
            id: o.id,
            name: o.name,
            values: o.values.map((x) => ({ id: x.id, value: x.value, swatchHex: x.swatchHex })),
          })),
          variants: detail.variants.map((v) => {
            const e = byTitle.get(v.title)!;
            return {
              id: v.id,
              sku: e.sku,
              title: v.title,
              optionValues: v.optionValues,
              pricePaise: e.price * 100,
              mrpPaise: e.mrp * 100,
              weightG: e.weightG ?? entry.weightG,
              lowStockThreshold: v.lowStockThreshold,
              active: v.active,
              initialStock: 0,
            };
          }),
        },
        actor,
      );
      log.productsUpdated++;
    }
  }

  // ---- 2. stock, through the ledger only -------------------------------------------------------
  for (const entry of catalogue.products) {
    const id = productIdBySlug.get(entry.slug)!;
    const detail = (await getAdminProduct(db, id))!;
    for (const v of detail.variants) {
      const target = entry.variants.find((e) => e.sku === v.sku)!.stock;
      const delta = target - v.onHand;
      if (delta === 0) continue;
      await adjustVariantStock(
        db,
        { variantId: v.id, delta, reason: delta > 0 ? "restock" : "correction", note: STOCK_NOTE },
        actor,
      );
      log.stockAdjustments++;
    }
  }

  // ---- 3. images ------------------------------------------------------------------------------
  const putSigned = async (url: string, body: Buffer, contentType: string) => {
    const res = await fetch(url, {
      method: "PUT",
      body: new Uint8Array(body),
      headers: { "Content-Type": contentType, "x-upsert": "false" },
    });
    if (!res.ok)
      throw new Error(`Upload PUT failed (${res.status}): ${await res.text().catch(() => "")}`);
  };

  const artCache = new Map<string, Awaited<ReturnType<typeof images.loadArt>>>();
  const artFor = async (slug: string) => {
    let a = artCache.get(slug);
    if (!a) {
      a = await images.loadArt(catalogue.artFiles[slug]!);
      artCache.set(slug, a);
    }
    return a;
  };

  const cm = (mm: number) => String(Math.round(mm) / 10);
  for (const entry of catalogue.products) {
    const id = productIdBySlug.get(entry.slug)!;
    const meta = entry.image;
    const wantAlt = {
      cutout: `${meta.visual} on a transparent background`,
      photos: [
        `${meta.visual} on a ${meta.bg1[1]} background`,
        `${meta.visual}, tilted slightly on a ${meta.bg2[1]} grid mat beside a ruler; it measures about ${cm(meta.sizeMm)} cm on its longest side`,
      ],
    };
    const rows = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.kind), asc(productImages.position));
    const stray = (r: (typeof rows)[number]) => !r.isPlaceholder && STRAY_TEST_ALTS.includes(r.alt);
    const placeholders = rows.filter((r) => r.isPlaceholder || stray(r));
    const realCutouts = rows.filter((r) => !r.isPlaceholder && !stray(r) && r.kind === "cutout");
    const realPhotos = rows.filter((r) => !r.isPlaceholder && !stray(r) && r.kind === "photo");

    const needCutout = realCutouts.length < 1;
    const needPhotos = Math.max(0, 2 - realPhotos.length);

    if (needCutout || needPhotos > 0) {
      const art = await artFor(entry.slug);
      if (needCutout) {
        const png = await images.renderCutout(art);
        const prepared = await prepareImageUpload(
          db,
          { productId: id, kind: "cutout", extension: "png" },
          actor,
        );
        await putSigned(prepared.url, png, "image/png");
        const done = await registerUploadedImage(
          db,
          { productId: id, kind: "cutout", dbPath: prepared.dbPath, alt: wantAlt.cutout },
          actor,
        );
        for (const w of done.warnings) console.warn(`  warning (${entry.slug} cutout): ${w}`);
        log.imagesUploaded++;
      }
      for (let i = realPhotos.length; i < 2; i++) {
        const jpg =
          i === 0 ? await images.renderPhotoOne(art, meta) : await images.renderPhotoTwo(art, meta);
        const prepared = await prepareImageUpload(
          db,
          { productId: id, kind: "photo", extension: "jpg" },
          actor,
        );
        await putSigned(prepared.url, jpg, "image/jpeg");
        const done = await registerUploadedImage(
          db,
          { productId: id, kind: "photo", dbPath: prepared.dbPath, alt: wantAlt.photos[i]! },
          actor,
        );
        for (const w of done.warnings)
          console.warn(`  warning (${entry.slug} photo ${i + 1}): ${w}`);
        log.imagesUploaded++;
      }
    } else {
      // Already uploaded on an earlier run: only keep the alt text in line with the data file.
      const pairs: [(typeof rows)[number], string][] = [
        [realCutouts[0]!, wantAlt.cutout],
        [realPhotos[0]!, wantAlt.photos[0]!],
        [realPhotos[1]!, wantAlt.photos[1]!],
      ];
      for (const [row, alt] of pairs) {
        if (row.alt !== alt) {
          await updateImageAlt(db, row.id, alt, actor);
          log.altUpdated++;
        }
      }
    }

    // Only now (the product always keeps an image) drop the placeholder rows.
    for (const ph of placeholders) {
      await deleteImage(db, ph.id, actor);
      log.imagesRemoved++;
    }
  }

  // ---- 4. home banners -------------------------------------------------------------------------
  const existingBanners = await listBanners(db, { placement: "home_offer" });
  const bannerArt = async (slug: string) => artFor(slug);
  for (const b of catalogue.banners) {
    if (!/^\/[^/]/.test(b.link)) throw new Error(`Banner "${b.title}": link must be a site path`);
    // Matched by title, or by link so a retitled banner is updated in place instead of duplicated.
    const found =
      existingBanners.find((x) => x.title === b.title) ??
      existingBanners.find((x) => x.link === b.link);
    let imagePath = found?.imagePath ?? null;
    if (!imagePath || (rerenderIdx >= 0 && RERENDER_BANNER === b.title)) {
      const pieces = [];
      for (const p of b.pieces)
        pieces.push({
          art: await bannerArt(p.slug),
          size: p.size,
          x: p.x,
          y: p.y,
          rotate: p.rotate,
        });
      const png = await images.renderBannerTile(b.tile, pieces);
      const prepared = await prepareBannerImageUpload({ extension: "png" }, actor);
      await putSigned(prepared.url, png, "image/png");
      const verified = await verifyBannerImage({ dbPath: prepared.dbPath }, actor);
      for (const w of verified.warnings) console.warn(`  warning (banner "${b.title}"): ${w}`);
      imagePath = verified.dbPath;
    }
    const input = {
      placement: "home_offer" as const,
      vibeId: null,
      title: b.title,
      body: b.body,
      imagePath,
      link: b.link,
      startsAt: null,
      endsAt: null,
      active: true,
    };
    if (!found) {
      await createBanner(db, input, actor);
      log.bannersCreated++;
    } else if (
      found.title !== b.title ||
      found.body !== b.body ||
      found.link !== b.link ||
      found.imagePath !== imagePath ||
      !found.active ||
      found.vibeId !== null ||
      found.startsAt !== null ||
      found.endsAt !== null
    ) {
      await updateBanner(db, found.id, input, actor);
      log.bannersUpdated++;
    }
  }

  // ---- 5. featured sets and hero tiles -----------------------------------------------------------
  const realCutoutRows = await db
    .select({ productId: productImages.productId })
    .from(productImages)
    .where(and(eq(productImages.kind, "cutout"), eq(productImages.isPlaceholder, false)));
  const hasRealCutout = new Set(realCutoutRows.map((r) => r.productId));
  for (const placement of ["home_featured", "hero_tiles"] as const) {
    const sets = placement === "home_featured" ? catalogue.featuredSets : catalogue.heroTiles;
    for (const vibe of vibeRows) {
      const list = sets[vibe.slug];
      if (!list) throw new Error(`No ${placement} list for vibe ${vibe.slug}`);
      const ids = list.map((s) => productIdBySlug.get(s)!);
      for (const [i, pid] of ids.entries()) {
        if (!hasRealCutout.has(pid))
          throw new Error(`${list[i]} has no real cutout yet (${placement}, ${vibe.slug})`);
      }
      const current = await db
        .select({ productId: featuredSlots.productId })
        .from(featuredSlots)
        .where(and(eq(featuredSlots.vibeId, vibe.id), eq(featuredSlots.placement, placement)))
        .orderBy(asc(featuredSlots.rank), asc(featuredSlots.createdAt), asc(featuredSlots.id));
      if (current.length === ids.length && current.every((c, i) => c.productId === ids[i]))
        continue;
      await setFeaturedSlots(db, { vibeId: vibe.id, placement, productIds: ids }, actor);
      log.setsChanged++;
    }
  }

  // ---- 6. report ------------------------------------------------------------------------------
  const after = await countRows();
  console.log("\napply-catalogue: done");
  console.log(
    `  products updated ${log.productsUpdated}, stock adjustments ${log.stockAdjustments}, images uploaded ${log.imagesUploaded}, ` +
      `placeholder images removed ${log.imagesRemoved}, alt texts updated ${log.altUpdated}, banners created ${log.bannersCreated} / updated ${log.bannersUpdated}, ` +
      `featured/hero sets changed ${log.setsChanged}`,
  );
  console.log(
    `  rows written this run: audit +${after.audit - before.audit}, ledger +${after.movements - before.movements}, product_images ${after.images - before.images >= 0 ? "+" : ""}${after.images - before.images}`,
  );

  // ---- 7. verification -------------------------------------------------------------------------
  const ids = [...productIdBySlug.values()];
  const imgRows = await db
    .select()
    .from(productImages)
    .where(inArray(productImages.productId, ids))
    .orderBy(asc(productImages.productId), asc(productImages.kind), asc(productImages.position));
  const stillPlaceholder = imgRows.filter(
    (r) => r.isPlaceholder || r.path.startsWith("/placeholders/"),
  );
  console.log(
    `\nimages for the ${slugs.length} products: ${imgRows.length} rows, placeholders left: ${stillPlaceholder.length}`,
  );
  let bad = 0;
  const urls = imgRows.map((r) => ({ url: resolveImageUrl(r.path), what: `${r.kind}` }));
  for (const b of await listBanners(db, { placement: "home_offer" })) {
    if (b.imagePath) urls.push({ url: resolveImageUrl(b.imagePath), what: `banner "${b.title}"` });
  }
  for (const u of urls) {
    const res = await fetch(u.url, { cache: "no-store" }).catch(() => null);
    if (!res || res.status !== 200) {
      bad++;
      console.log(`  NOT 200: ${u.what} ${u.url} -> ${res?.status ?? "no response"}`);
    } else {
      await res.arrayBuffer();
    }
  }
  console.log(`image URLs checked: ${urls.length}, not HTTP 200: ${bad}`);

  const readiness = await getLaunchReadiness(db);
  console.log(`\nlaunch checklist: ${readiness.blockers} blockers, ${readiness.warnings} warnings`);
  for (const item of readiness.items) {
    console.log(
      `  [${item.category}/${item.severity}] ${item.title}${item.detail ? ` - ${item.detail}` : ""}`,
    );
  }
  for (const c of readiness.categories) {
    console.log(`  ${c.label.padEnd(24)} blockers ${c.blockers}, warnings ${c.warnings}`);
  }
  if (bad > 0 || stillPlaceholder.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
