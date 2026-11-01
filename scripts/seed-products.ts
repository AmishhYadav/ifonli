/**
 * DEV-ONLY placeholder catalogue: one product per placeholder cutout in
 * public/placeholders/cutouts/manifest.json (32), with vibes, featured slots, variants, images and
 * opening stock. Idempotent: products upsert by slug, variants by SKU (stock is only written when a
 * variant is first created, so reseeding never clobbers adjustments), images/slots refresh in place.
 *
 *   pnpm db:seed-products                 (needs `pnpm db:seed` first: vibes + product types)
 *   pnpm db:seed-products --force-placeholder --allow-remote   (required for any database that is not local)
 *
 * Everything here is PLACEHOLDER: names/copy/prices/stock/origin must be replaced by the owner.
 * Seeded variants are recognisable by the `PH-` SKU prefix and images by `is_placeholder = true`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";

import { isLocalDatabase } from "./db-guard";

config({ path: ".env.local" });
config();

// Placeholder products must never reach a real catalogue by accident. `NODE_ENV` is unset under
// tsx, so the guard looks at the database host: anything but this machine needs BOTH flags.
const FORCE = process.argv.includes("--force-placeholder");
const REMOTE_OK = process.argv.includes("--allow-remote");
if ((process.env.NODE_ENV === "production" || !isLocalDatabase()) && !(FORCE && (isLocalDatabase() || REMOTE_OK))) {
  console.error(
    "seed-products: refusing to seed placeholder products into a database that is not local " +
      "(or with NODE_ENV=production). If you really mean it, pass --force-placeholder --allow-remote.",
  );
  process.exit(1);
}

interface ManifestItem {
  file: string;
  type: "charm" | "hipper" | "sticker3d" | "diy";
  name: string;
  suggestedVibes: string[];
  palette: string[];
}

const TYPE_SLUG = {
  charm: "charms",
  hipper: "hippers",
  sticker3d: "3d-stickers",
  diy: "diy-accessories",
} as const;

const TYPE_NOUN = {
  charm: "charm",
  hipper: "hair and bag accessory",
  sticker3d: "3D sticker",
  diy: "DIY accessory",
} as const;

const PRICE_RUPEES = {
  charm: [149, 179, 199, 229, 249, 299, 349, 399],
  hipper: [199, 229, 249, 299, 349],
  sticker3d: [99, 129, 149, 179, 199, 249],
  diy: [399, 499, 599, 699, 799, 999],
} as const;

const WEIGHT_G = { charm: 12, hipper: 15, sticker3d: 6, diy: 80 } as const;

/** One neutral, playful line per product. No material or size claims. */
const HOOK: Record<string, string> = {
  "charm-heart": "A little heart for the days you feel soft.",
  "charm-star": "A tiny star to wish on, or just to look at.",
  "charm-mushroom": "A mushroom that looks like it has a secret garden.",
  "charm-cherries": "Two cherries, one good decision.",
  "charm-skull": "A grinning skull for the days you feel dramatic.",
  "charm-ghost": "A ghost that mostly wants to be left alone.",
  "charm-lightning": "A bolt of loud energy, no battery needed.",
  "charm-smiley": "A smiley that is a bit too happy about everything.",
  "charm-moon": "A crescent moon for late-night thinkers.",
  "charm-evil-eye": "An eye that is always watching, politely.",
  "hipper-bow-clip": "A bow clip that says you tried today.",
  "hipper-daisy-pin": "A daisy pin for a small patch of spring.",
  "hipper-flame-pin": "A flame pin for turning up the heat.",
  "hipper-crossed-bones-pin": "Crossed bones, because subtlety is overrated.",
  "hipper-rainbow-pin": "A rainbow pin for a cloudy mood.",
  "hipper-coffee-pin": "A coffee cup pin for a slow morning.",
  "sticker3d-cloud": "A puffy cloud to carry your head up there.",
  "sticker3d-strawberry": "A puffy strawberry, extra sweet by design.",
  "sticker3d-cat-face": "A puffy cat face that judges you lovingly.",
  "sticker3d-wow": "Big bubble letters for big reactions.",
  "sticker3d-hmm-bubble": 'A thought bubble that says "hmm?" so you do not have to.',
  "sticker3d-notebook-doodle": "A spiral notebook doodle for ideas you will definitely revisit.",
  "sticker3d-bat": "A puffy bat that hangs around.",
  "sticker3d-candle": "A candle sticker with all the glow and none of the wax.",
  "sticker3d-groovy-flower": "A groovy flower straight out of a good mood.",
  "sticker3d-retro-sun": "A retro sun that always wakes up on time.",
  "diy-bead-strand": "A strand of beads waiting for your plan.",
  "diy-chain-links": "Chain links for building something bold.",
  "diy-letter-beads-if": 'Letter beads so you can spell "IF" or whatever you mean.',
  "diy-charm-bracelet-kit": "A charm bracelet kit for the maker in a moody phase.",
  "diy-phone-strap-kit": "A phone strap kit for a phone that deserves personality.",
  "diy-keychain-ring": "A keychain ring and tag, ready for your charms.",
};

const TYPE_LINE = {
  charm: "Clip it on a bag, keys or a zip and make it yours.",
  hipper: "Wear it in your hair, on a jacket or on your bag.",
  sticker3d: "Stick it on a phone case, laptop or notebook cover.",
  diy: "Mix, match and make something one-of-a-kind.",
} as const;

interface VariantSpec {
  option: string;
  values: { value: string; hex?: string; stock?: number }[];
  /** "pack": pack of 3 costs about 2.5x. "same": every value has the base price. */
  pricing: "same" | "pack";
}

const VARIANT_SPECS: Record<string, VariantSpec> = {
  "charm-heart": {
    option: "Colour",
    pricing: "same",
    values: [
      { value: "Pink", hex: "#FF5C8A", stock: 4 },
      { value: "Red", hex: "#E5243B" },
      { value: "Lilac", hex: "#B79CED" },
    ],
  },
  "charm-star": {
    option: "Colour",
    pricing: "same",
    values: [
      { value: "Yellow", hex: "#FFD23F" },
      { value: "Silver", hex: "#C0C4CC" },
    ],
  },
  "charm-skull": {
    option: "Finish",
    pricing: "same",
    values: [
      { value: "Bone", hex: "#F5F0E6" },
      { value: "Midnight", hex: "#2A2035" },
    ],
  },
  "hipper-bow-clip": {
    option: "Colour",
    pricing: "same",
    values: [
      { value: "Blush", hex: "#FFB3C7" },
      { value: "Black", hex: "#1A1A1A" },
      { value: "Cream", hex: "#FFF1DC" },
    ],
  },
  "hipper-daisy-pin": {
    option: "Pack",
    pricing: "pack",
    values: [{ value: "Pack of 1" }, { value: "Pack of 3" }],
  },
  "sticker3d-cat-face": {
    option: "Pack",
    pricing: "pack",
    values: [{ value: "Pack of 1" }, { value: "Pack of 3" }],
  },
  "diy-bead-strand": {
    option: "Colour",
    pricing: "same",
    values: [
      { value: "Pastel mix", hex: "#F7C8E0" },
      { value: "Neon mix", hex: "#B6FF3B" },
      { value: "Earth mix", hex: "#A47551" },
    ],
  },
  "diy-phone-strap-kit": {
    option: "Colour",
    pricing: "same",
    values: [
      { value: "Coral", hex: "#FF7A59" },
      { value: "Teal", hex: "#2EC4B6" },
    ],
  },
};

/** Single-variant stock overrides: two sold out, three low. */
const STOCK_OVERRIDE: Record<string, number> = {
  "charm-lightning": 0,
  "sticker3d-candle": 0,
  "sticker3d-wow": 3,
  "diy-chain-links": 2,
};
// plus the "Pink" heart charm variant (4), set in VARIANT_SPECS above.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Round a rupee amount up to the next price ending in 9. */
function endIn9(rupees: number): number {
  return Math.ceil((rupees + 1) / 10) * 10 - 1;
}

async function main() {
  const manifestPath = path.join(process.cwd(), "public/placeholders/cutouts/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestItem[];

  const { and, eq, inArray, like, notInArray, sql } = await import("drizzle-orm");
  const { getDb } = await import("../src/server/db");
  const schema = await import("../src/server/db/schema");
  const {
    featuredSlots,
    inventoryMovements,
    productImages,
    productOptionValues,
    productOptions,
    productTypes,
    productVibes,
    products,
    variants,
    vibes,
  } = schema;
  const db = getDb();

  const vibeRows = await db.select().from(vibes);
  const typeRows = await db.select().from(productTypes);
  if (vibeRows.length === 0 || typeRows.length === 0) {
    throw new Error("No vibes / product types found. Run `pnpm db:seed` first.");
  }
  const vibeId = new Map(vibeRows.map((v) => [v.slug, v.id]));
  const vibeName = new Map(vibeRows.map((v) => [v.slug, v.name]));
  const typeId = new Map(typeRows.map((t) => [t.slug, t.id]));

  // Per-vibe ordering: products whose first suggested vibe is this vibe come first.
  const primaryRank = new Map<string, number>(); // file -> featured_rank in its primary vibe
  const slotCandidates = new Map<string, string[]>(); // vibe -> files in slot order
  for (const slug of vibeId.keys()) {
    const primary = manifest.filter((m) => m.suggestedVibes[0] === slug);
    const secondary = manifest.filter(
      (m) => m.suggestedVibes[0] !== slug && m.suggestedVibes.includes(slug),
    );
    primary.forEach((m, i) => primaryRank.set(m.file, i));
    slotCandidates.set(slug, [...primary, ...secondary].map((m) => m.file));
  }

  const counts = { products: 0, variants: 0, variantsCreated: 0, images: 0, featuredSlots: 0 };
  const warnings: string[] = [];

  await db.transaction(async (tx) => {
    for (const [idx, item] of manifest.entries()) {
      const base = item.file.replace(/\.svg$/, "");
      const slug = slugify(item.name);
      const tId = typeId.get(TYPE_SLUG[item.type]);
      if (!tId) throw new Error(`Missing product type "${TYPE_SLUG[item.type]}"`);
      const primaryVibe = item.suggestedVibes[0]!;
      const spec = VARIANT_SPECS[base];
      const isKit = /\bkit\b/i.test(item.name);
      const hook = HOOK[base] ?? `${item.name}.`;
      const description = `${hook} ${TYPE_LINE[item.type]} Part of our ${vibeName.get(primaryVibe) ?? primaryVibe} mood.`;
      const netQuantity = spec?.pricing === "pack" ? "1 piece / Pack of 3 (as selected)" : isKit ? "1 kit" : "1 piece";

      const [product] = await tx
        .insert(products)
        .values({
          slug,
          name: item.name,
          descriptionMd: description,
          typeId: tId,
          status: "active",
          seoTitle: `${item.name} | IfOnli`,
          seoDesc: hook,
          countryOfOrigin: "India",
          netQuantity,
          isKit,
          createdAt: new Date(Date.now() - idx * 1000),
        })
        .onConflictDoUpdate({
          target: products.slug,
          set: {
            name: item.name,
            descriptionMd: description,
            typeId: tId,
            status: "active",
            seoTitle: `${item.name} | IfOnli`,
            seoDesc: hook,
            countryOfOrigin: "India",
            netQuantity,
            isKit,
          },
        })
        .returning({ id: products.id });
      const productId = product!.id;
      counts.products++;

      // ---- vibes (featured_rank only on the primary vibe)
      const wantedVibeIds = item.suggestedVibes
        .map((v) => vibeId.get(v))
        .filter((id): id is string => id !== undefined);
      for (const v of item.suggestedVibes) {
        const id = vibeId.get(v);
        if (!id) continue;
        const rank = v === primaryVibe ? (primaryRank.get(item.file) ?? null) : null;
        await tx
          .insert(productVibes)
          .values({ productId, vibeId: id, featuredRank: rank })
          .onConflictDoUpdate({
            target: [productVibes.productId, productVibes.vibeId],
            set: { featuredRank: rank },
          });
      }
      if (wantedVibeIds.length) {
        await tx
          .delete(productVibes)
          .where(
            and(eq(productVibes.productId, productId), notInArray(productVibes.vibeId, wantedVibeIds)),
          );
      }

      // ---- price (deterministic per slug)
      const h = hash(slug);
      const list = PRICE_RUPEES[item.type];
      const priceRupees = list[h % list.length]!;
      const hasMrp = (h >>> 8) % 10 < 3;
      const mrpRupees = hasMrp ? endIn9(Math.round(priceRupees * 1.3)) : priceRupees;
      const baseStock = 8 + ((h >>> 4) % 33); // 8..40

      // ---- options + variants
      type VariantPlan = {
        sku: string;
        title: string;
        optionValueId?: string;
        priceRupees: number;
        mrpRupees: number;
        stock: number;
      };
      const plans: VariantPlan[] = [];
      if (spec) {
        const [option] = await tx
          .insert(productOptions)
          .values({ productId, name: spec.option, position: 0 })
          .onConflictDoUpdate({
            target: [productOptions.productId, productOptions.name],
            set: { position: 0 },
          })
          .returning({ id: productOptions.id });
        for (const [vi, v] of spec.values.entries()) {
          const [val] = await tx
            .insert(productOptionValues)
            .values({ optionId: option!.id, value: v.value, swatchHex: v.hex ?? null, position: vi })
            .onConflictDoUpdate({
              target: [productOptionValues.optionId, productOptionValues.value],
              set: { swatchHex: v.hex ?? null, position: vi },
            })
            .returning({ id: productOptionValues.id });
          const isPack3 = spec.pricing === "pack" && vi === 1;
          const p = isPack3 ? endIn9(Math.round(priceRupees * 2.5)) : priceRupees;
          const m = isPack3
            ? endIn9(Math.round(mrpRupees * 2.5))
            : mrpRupees;
          plans.push({
            sku: `PH-${base}-${slugify(v.value)}`.toUpperCase(),
            title: v.value,
            optionValueId: val!.id,
            priceRupees: p,
            mrpRupees: Math.max(m, p),
            stock: v.stock ?? STOCK_OVERRIDE[base] ?? baseStock,
          });
        }
      } else {
        plans.push({
          sku: `PH-${base}`.toUpperCase(),
          title: "Default",
          priceRupees,
          mrpRupees,
          stock: STOCK_OVERRIDE[base] ?? baseStock,
        });
      }

      for (const [pos, plan] of plans.entries()) {
        const optionValueIds = plan.optionValueId ? [plan.optionValueId] : [];
        const [row] = await tx
          .insert(variants)
          .values({
            productId,
            sku: plan.sku,
            title: plan.title,
            optionValueIds,
            pricePaise: plan.priceRupees * 100,
            mrpPaise: plan.mrpRupees * 100,
            stockOnHand: plan.stock,
            weightG: WEIGHT_G[item.type],
            position: pos,
            active: true,
          })
          .onConflictDoUpdate({
            target: variants.sku,
            set: {
              productId,
              title: plan.title,
              optionValueIds,
              pricePaise: plan.priceRupees * 100,
              mrpPaise: plan.mrpRupees * 100,
              weightG: WEIGHT_G[item.type],
              position: pos,
              active: true,
            },
          })
          .returning({ id: variants.id, inserted: sql<boolean>`(xmax = 0)` });
        counts.variants++;
        if (row!.inserted) {
          counts.variantsCreated++;
          if (plan.stock > 0) {
            await tx.insert(inventoryMovements).values({
              variantId: row!.id,
              delta: plan.stock,
              reason: "restock",
              actorId: null,
              note: "Dev seed: placeholder opening stock",
            });
          }
        }
      }

      // ---- images: cutout doubles as the photo until real photography exists
      await tx
        .delete(productImages)
        .where(and(eq(productImages.productId, productId), like(productImages.path, "/placeholders/%")));
      const imagePath = `/placeholders/cutouts/${item.file}`;
      await tx.insert(productImages).values([
        {
          productId,
          kind: "photo",
          path: imagePath,
          alt: `Illustration of the ${item.name}, a ${TYPE_NOUN[item.type]}, on a plain background`,
          width: 512,
          height: 512,
          position: 0,
          isPlaceholder: true,
        },
        {
          productId,
          kind: "cutout",
          path: imagePath,
          alt: `Cut-out illustration of the ${item.name}`,
          width: 512,
          height: 512,
          position: 0,
          isPlaceholder: true,
        },
      ]);
      counts.images += 2;
    }

    // ---- featured slots: first 8 per vibe, for the home featured sets and the hero tiles
    const productIdBySlug = new Map(
      (
        await tx
          .select({ id: products.id, slug: products.slug })
          .from(products)
          .where(inArray(products.slug, manifest.map((m) => slugify(m.name))))
      ).map((p) => [p.slug, p.id]),
    );
    let slots = 0;
    for (const [vibe, files] of slotCandidates) {
      const vId = vibeId.get(vibe)!;
      for (const [rank, file] of files.slice(0, 8).entries()) {
        const item = manifest.find((m) => m.file === file)!;
        const pid = productIdBySlug.get(slugify(item.name))!;
        for (const placement of ["home_featured", "hero_tiles"] as const) {
          await tx
            .insert(featuredSlots)
            .values({ vibeId: vId, placement, productId: pid, rank })
            .onConflictDoUpdate({
              target: [featuredSlots.vibeId, featuredSlots.placement, featuredSlots.productId],
              set: { rank },
            });
          slots++;
        }
      }
    }
    counts.featuredSlots = slots;
  });

  const [{ n: totalProducts } = { n: 0 }] = await db
    .select({ n: sql<number>`count(distinct ${variants.productId})::int` })
    .from(variants)
    .where(like(variants.sku, "PH-%"));
  const [{ n: totalVariants } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(variants)
    .where(like(variants.sku, "PH-%"));
  const [{ n: totalImages } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(productImages)
    .where(eq(productImages.isPlaceholder, true));
  const [{ n: totalSlots } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(featuredSlots);

  console.log(
    `seed-products: ${counts.products} products upserted, ${counts.variants} variants upserted ` +
      `(${counts.variantsCreated} newly created), ${counts.images} images refreshed, ` +
      `${counts.featuredSlots} featured slots upserted.`,
  );
  console.log(
    `DB totals: PH- products=${totalProducts}, PH- variants=${totalVariants}, placeholder images=${totalImages}, featured_slots=${totalSlots}`,
  );
  warnings.push(
    "ALL seeded names, copy, PRICES, MRPs, stock, country of origin and net quantity are PLACEHOLDERS.",
    "Seeded variants have SKUs starting with 'PH-'; seeded images have is_placeholder = true.",
    "Replace every PH- product before launch (see docs/CATALOG.md).",
  );
  for (const w of warnings) console.warn(`WARNING: ${w}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
