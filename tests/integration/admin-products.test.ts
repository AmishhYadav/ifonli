import { eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { getDb } from "@/server/db";
import {
  adminAuditLog,
  inventoryMovements,
  productImages,
  productOptionValues,
  productOptions,
  productTypes,
  productVibes,
  products,
  user,
  variants,
  vibes,
} from "@/server/db/schema";
import {
  AdminInputError,
  SkuTakenError,
  SlugTakenError,
  createProduct,
  duplicateProduct,
  getAdminProduct,
  isSlugAvailable,
  listAdminProducts,
  setProductStatus,
  updateProduct,
  type AdminActor,
} from "@/server/services/admin/products";
import {
  deleteImage,
  inspectImage,
  insertImageRecord,
  reorderImages,
  updateImageAlt,
} from "@/server/services/admin/product-images";
import { adjustStock } from "@/server/services/inventory";

const db = () => getDb();

async function setup() {
  const [type] = await db()
    .insert(productTypes)
    .values({ slug: "charms", name: "Charms" })
    .returning();
  const vibeRows = await db()
    .insert(vibes)
    .values([
      { slug: "cute", name: "Cute", sort: 1 },
      { slug: "gothic", name: "Gothic", sort: 2 },
    ])
    .returning();
  await db()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" },
      { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" },
      { id: "ful-1", name: "Packer", email: "ful@example.com", role: "fulfilment" },
    ]);
  const owner: AdminActor = { id: "owner-1", role: "owner", ip: "203.0.113.5" };
  const fulfilment: AdminActor = { id: "ful-1", role: "fulfilment" };
  return {
    typeId: type!.id,
    cute: vibeRows.find((v) => v.slug === "cute")!.id,
    gothic: vibeRows.find((v) => v.slug === "gothic")!.id,
    owner,
    fulfilment,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function input(s: Setup, over: Record<string, unknown> = {}) {
  return {
    name: "Skull charm",
    slug: "skull-charm",
    descriptionMd: "A **tiny** skull.",
    typeId: s.typeId,
    status: "active",
    isKit: false,
    vibes: [{ vibeId: s.cute, featuredRank: 2 }],
    options: [],
    variants: [
      {
        sku: "skull-1",
        title: "Default",
        optionValues: [],
        pricePaise: 19900,
        mrpPaise: 24900,
        active: true,
        initialStock: 10,
      },
    ],
    ...over,
  };
}

const optionInput = {
  options: [
    { name: "Colour", values: [{ value: "Pink", swatchHex: "#FF5C8A" }, { value: "Red" }] },
  ],
  variants: [
    {
      sku: "heart-pink",
      title: "x",
      optionValues: ["Pink"],
      pricePaise: 14900,
      mrpPaise: 14900,
      active: true,
      initialStock: 5,
    },
    {
      sku: "heart-red",
      title: "x",
      optionValues: ["Red"],
      pricePaise: 17900,
      mrpPaise: 19900,
      active: true,
      initialStock: 0,
    },
  ],
};

describe("createProduct", () => {
  it("writes product, vibes, variants, opening stock through the ledger and an audit row", async () => {
    const s = await setup();
    const res = await createProduct(db(), input(s), s.owner);
    expect(res.slug).toBe("skull-charm");
    expect(res.stockChanged).toBe(true);
    expect(res.invalidation).toMatchObject({
      productIds: [res.id],
      productSlugs: ["skull-charm"],
      vibeSlugs: ["cute"],
      typeSlugs: ["charms"],
    });

    const detail = await getAdminProduct(db(), res.id);
    expect(detail?.variants).toHaveLength(1);
    expect(detail?.variants[0]).toMatchObject({
      sku: "SKULL-1",
      pricePaise: 19900,
      mrpPaise: 24900,
      onHand: 10,
      hasHistory: true,
    });
    expect(detail?.vibes).toEqual([{ vibeId: s.cute, featuredRank: 2 }]);

    const moves = await db().select().from(inventoryMovements);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      delta: 10,
      reason: "restock",
      actorId: "owner-1",
      note: "Initial stock",
    });

    const [audit] = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "product.create"));
    expect(audit).toMatchObject({
      actorId: "owner-1",
      entity: "product",
      entityId: res.id,
      ip: "203.0.113.5",
    });
  });

  it("stores options and maps variants to option value ids", async () => {
    const s = await setup();
    const res = await createProduct(
      db(),
      input(s, { name: "Heart", slug: "heart", ...optionInput }),
      s.owner,
    );
    const detail = await getAdminProduct(db(), res.id);
    expect(detail?.options).toHaveLength(1);
    expect(detail?.options[0]?.values.map((v) => v.value)).toEqual(["Pink", "Red"]);
    expect(detail?.variants.map((v) => v.optionValues)).toEqual([["Pink"], ["Red"]]);
    expect(detail?.variants.map((v) => v.onHand)).toEqual([5, 0]);
  });

  it("rejects price above MRP (validation) and the DB check is not reached", async () => {
    const s = await setup();
    const bad = input(s, {
      variants: [
        {
          sku: "bad-1",
          title: "Default",
          optionValues: [],
          pricePaise: 30000,
          mrpPaise: 24900,
          active: true,
        },
      ],
    });
    await expect(createProduct(db(), bad, s.owner)).rejects.toBeInstanceOf(ZodError);
    expect(await db().select().from(products)).toHaveLength(0);
  });

  it("rejects duplicate slugs and SKUs with typed errors, leaving nothing behind", async () => {
    const s = await setup();
    await createProduct(db(), input(s), s.owner);
    await expect(
      createProduct(
        db(),
        input(s, {
          variants: [
            {
              sku: "other",
              title: "Default",
              optionValues: [],
              pricePaise: 1,
              mrpPaise: 1,
              active: true,
            },
          ],
        }),
        s.owner,
      ),
    ).rejects.toBeInstanceOf(SlugTakenError);
    await expect(
      createProduct(db(), input(s, { slug: "another", name: "Another" }), s.owner),
    ).rejects.toBeInstanceOf(SkuTakenError);
    expect(await db().select().from(products)).toHaveLength(1);
    expect(await isSlugAvailable(db(), "skull-charm")).toBe(false);
    expect(await isSlugAvailable(db(), "fresh")).toBe(true);
  });

  it("validates structure: several variants need an option, active needs an active variant", async () => {
    const s = await setup();
    const twoVariants = input(s, {
      variants: [
        { sku: "a-1", title: "A", optionValues: [], pricePaise: 1, mrpPaise: 1, active: true },
        { sku: "a-2", title: "B", optionValues: [], pricePaise: 1, mrpPaise: 1, active: true },
      ],
    });
    await expect(createProduct(db(), twoVariants, s.owner)).rejects.toBeInstanceOf(ZodError);
    const noneActive = input(s, {
      variants: [
        { sku: "a-1", title: "A", optionValues: [], pricePaise: 1, mrpPaise: 1, active: false },
      ],
    });
    await expect(createProduct(db(), noneActive, s.owner)).rejects.toBeInstanceOf(ZodError);
    await expect(
      createProduct(db(), input(s, { typeId: crypto.randomUUID() }), s.owner),
    ).rejects.toBeInstanceOf(AdminInputError);
  });

  it("denies the fulfilment role (and writes nothing)", async () => {
    const s = await setup();
    await expect(createProduct(db(), input(s), s.fulfilment)).rejects.toThrow(/Forbidden/);
    expect(await db().select().from(products)).toHaveLength(0);
    expect(await db().select().from(adminAuditLog)).toHaveLength(0);
  });
});

describe("updateProduct", () => {
  it("renames, invalidates the old slug, replaces vibes and audits the diff", async () => {
    const s = await setup();
    const created = await createProduct(db(), input(s), s.owner);
    const detail = (await getAdminProduct(db(), created.id))!;
    const res = await updateProduct(
      db(),
      created.id,
      input(s, {
        name: "Skull charm v2",
        slug: "skull-charm-v2",
        vibes: [{ vibeId: s.gothic, featuredRank: 1 }],
        variants: [
          {
            id: detail.variants[0]!.id,
            sku: "skull-1",
            title: "Default",
            optionValues: [],
            pricePaise: 18900,
            mrpPaise: 24900,
            active: true,
          },
        ],
      }),
      s.owner,
    );
    expect(res.invalidation.productSlugs).toEqual(
      expect.arrayContaining(["skull-charm", "skull-charm-v2"]),
    );
    expect(res.invalidation.vibeSlugs).toEqual(expect.arrayContaining(["cute", "gothic"]));
    const after = (await getAdminProduct(db(), created.id))!;
    expect(after.slug).toBe("skull-charm-v2");
    expect(after.vibes).toEqual([{ vibeId: s.gothic, featuredRank: 1 }]);
    expect(after.variants[0]?.pricePaise).toBe(18900);

    const [audit] = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "product.update"));
    expect(audit?.diff).toMatchObject({
      slug: { from: "skull-charm", to: "skull-charm-v2" },
      name: { from: "Skull charm", to: "Skull charm v2" },
    });
  });

  it("never changes stock of existing variants, ignores initialStock for them, ledger stays in step", async () => {
    const s = await setup();
    const created = await createProduct(db(), input(s), s.owner);
    const detail = (await getAdminProduct(db(), created.id))!;
    const v = detail.variants[0]!;
    await adjustStock({ variantId: v.id, delta: -3, reason: "adjust", actorId: "owner-1" });
    await updateProduct(
      db(),
      created.id,
      input(s, {
        variants: [
          {
            id: v.id,
            sku: "skull-1",
            title: "Default",
            optionValues: [],
            pricePaise: 19900,
            mrpPaise: 24900,
            active: true,
            initialStock: 500,
          },
        ],
      }),
      s.owner,
    );
    const [row] = await db().select().from(variants).where(eq(variants.id, v.id));
    expect(row?.stockOnHand).toBe(7);
    const moves = await db()
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, v.id));
    expect(moves.reduce((n, m) => n + m.delta, 0)).toBe(7);
  });

  it("adds a variant with opening stock via the ledger and renames an option value in place", async () => {
    const s = await setup();
    const created = await createProduct(
      db(),
      input(s, { name: "Heart", slug: "heart", ...optionInput }),
      s.owner,
    );
    const d = (await getAdminProduct(db(), created.id))!;
    const opt = d.options[0]!;
    const pink = opt.values.find((x) => x.value === "Pink")!;
    const red = opt.values.find((x) => x.value === "Red")!;
    await updateProduct(
      db(),
      created.id,
      input(s, {
        name: "Heart",
        slug: "heart",
        options: [
          {
            id: opt.id,
            name: "Colour",
            values: [
              { id: pink.id, value: "Rose" },
              { id: red.id, value: "Red" },
              { value: "Lilac" },
            ],
          },
        ],
        variants: [
          {
            id: d.variants[0]!.id,
            sku: "heart-pink",
            title: "x",
            optionValues: ["Rose"],
            pricePaise: 14900,
            mrpPaise: 14900,
            active: true,
          },
          {
            id: d.variants[1]!.id,
            sku: "heart-red",
            title: "x",
            optionValues: ["Red"],
            pricePaise: 17900,
            mrpPaise: 19900,
            active: true,
          },
          {
            sku: "heart-lilac",
            title: "x",
            optionValues: ["Lilac"],
            pricePaise: 17900,
            mrpPaise: 19900,
            active: true,
            initialStock: 9,
          },
        ],
      }),
      s.owner,
    );
    const after = (await getAdminProduct(db(), created.id))!;
    expect(after.variants.map((v) => [v.sku, v.optionValues[0], v.onHand])).toEqual([
      ["HEART-PINK", "Rose", 5],
      ["HEART-RED", "Red", 0],
      ["HEART-LILAC", "Lilac", 9],
    ]);
    // Same value row, renamed (id kept).
    expect(after.options[0]?.values.find((v) => v.value === "Rose")?.id).toBe(pink.id);
    expect(await db().select().from(productOptions)).toHaveLength(1);
    expect(await db().select().from(productOptionValues)).toHaveLength(3);
  });

  it("deletes a dropped variant without history and deactivates one with history", async () => {
    const s = await setup();
    const created = await createProduct(
      db(),
      input(s, { name: "Heart", slug: "heart", ...optionInput }),
      s.owner,
    );
    const d = (await getAdminProduct(db(), created.id))!;
    const opt = d.options[0]!;
    // Pink had opening stock (history), Red did not.
    await updateProduct(
      db(),
      created.id,
      input(s, {
        name: "Heart",
        slug: "heart",
        options: [
          {
            id: opt.id,
            name: "Colour",
            values: opt.values.map((v) => ({ id: v.id, value: v.value })),
          },
        ],
        variants: [
          {
            id: d.variants[1]!.id,
            sku: "heart-red",
            title: "x",
            optionValues: ["Red"],
            pricePaise: 17900,
            mrpPaise: 19900,
            active: true,
          },
        ],
      }),
      s.owner,
    );
    const rows = await db().select().from(variants).where(eq(variants.productId, created.id));
    expect(rows.map((r) => [r.sku, r.active]).sort()).toEqual([
      ["HEART-PINK", false],
      ["HEART-RED", true],
    ]);
  });

  it("rejects a SKU belonging to another product and a missing product", async () => {
    const s = await setup();
    await createProduct(db(), input(s), s.owner);
    const other = await createProduct(
      db(),
      input(s, {
        name: "Other",
        slug: "other",
        variants: [
          {
            sku: "other-1",
            title: "Default",
            optionValues: [],
            pricePaise: 1,
            mrpPaise: 1,
            active: true,
          },
        ],
      }),
      s.owner,
    );
    const od = (await getAdminProduct(db(), other.id))!;
    await expect(
      updateProduct(
        db(),
        other.id,
        input(s, {
          name: "Other",
          slug: "other",
          variants: [
            {
              id: od.variants[0]!.id,
              sku: "skull-1",
              title: "Default",
              optionValues: [],
              pricePaise: 1,
              mrpPaise: 1,
              active: true,
            },
          ],
        }),
        s.owner,
      ),
    ).rejects.toBeInstanceOf(SkuTakenError);
    await expect(
      updateProduct(
        db(),
        crypto.randomUUID(),
        input(s, {
          slug: "zzz",
          variants: [
            {
              sku: "zzz-1",
              title: "Default",
              optionValues: [],
              pricePaise: 1,
              mrpPaise: 1,
              active: true,
            },
          ],
        }),
        s.owner,
      ),
    ).rejects.toThrow(/not found/);
  });

  it("denies fulfilment", async () => {
    const s = await setup();
    const created = await createProduct(db(), input(s), s.owner);
    await expect(updateProduct(db(), created.id, input(s), s.fulfilment)).rejects.toThrow(
      /Forbidden/,
    );
  });
});

describe("status, duplicate, listing", () => {
  it("archives (needs product:archive), restores and audits", async () => {
    const s = await setup();
    const created = await createProduct(db(), input(s), s.owner);
    await expect(setProductStatus(db(), created.id, "archived", s.fulfilment)).rejects.toThrow(
      /Forbidden/,
    );
    const res = await setProductStatus(db(), created.id, "archived", s.owner);
    expect(res.invalidation.productSlugs).toEqual(["skull-charm"]);
    const [row] = await db().select().from(products).where(eq(products.id, created.id));
    expect(row?.status).toBe("archived");
    await setProductStatus(db(), created.id, "draft", s.owner);
    const audits = await db().select().from(adminAuditLog);
    expect(audits.map((a) => a.action).sort()).toEqual([
      "product.archive",
      "product.create",
      "product.status",
    ]);
  });

  it("duplicates as a draft with copied options, zero stock, fresh SKUs and unfeatured vibes", async () => {
    const s = await setup();
    const created = await createProduct(
      db(),
      input(s, { name: "Heart", slug: "heart", ...optionInput }),
      s.owner,
    );
    const copy = await duplicateProduct(db(), created.id, s.owner);
    expect(copy.slug).toBe("heart-copy");
    const d = (await getAdminProduct(db(), copy.id))!;
    expect(d.status).toBe("draft");
    expect(d.name).toBe("Heart (copy)");
    expect(d.variants.map((v) => [v.sku, v.onHand, v.optionValues[0]])).toEqual([
      ["HEART-PINK-COPY", 0, "Pink"],
      ["HEART-RED-COPY", 0, "Red"],
    ]);
    expect(d.vibes[0]?.featuredRank).toBeNull();
    // Option values are distinct rows from the original's.
    expect(await db().select().from(productOptionValues)).toHaveLength(4);
    expect((await duplicateProduct(db(), created.id, s.owner)).slug).toBe("heart-copy-2");
    await expect(duplicateProduct(db(), created.id, s.fulfilment)).rejects.toThrow(/Forbidden/);
  });

  it("lists with filters and stock state from availability", async () => {
    const s = await setup();
    await createProduct(db(), input(s), s.owner); // 10 in stock, cute
    await createProduct(
      db(),
      input(s, {
        name: "Gone",
        slug: "gone",
        vibes: [{ vibeId: s.gothic, featuredRank: null }],
        status: "draft",
        variants: [
          {
            sku: "gone-1",
            title: "Default",
            optionValues: [],
            pricePaise: 100,
            mrpPaise: 100,
            active: true,
            initialStock: 0,
          },
        ],
      }),
      s.owner,
    );
    const all = await listAdminProducts(db());
    expect(all.total).toBe(2);
    expect((await listAdminProducts(db(), { stock: "out" })).items.map((i) => i.slug)).toEqual([
      "gone",
    ]);
    expect((await listAdminProducts(db(), { vibe: "cute" })).items.map((i) => i.slug)).toEqual([
      "skull-charm",
    ]);
    expect((await listAdminProducts(db(), { status: "draft" })).items.map((i) => i.slug)).toEqual([
      "gone",
    ]);
    expect((await listAdminProducts(db(), { q: "SKULL-1" })).items.map((i) => i.slug)).toEqual([
      "skull-charm",
    ]);
    expect((await listAdminProducts(db(), { q: "%" })).total).toBe(0);
  });
});

describe("images", () => {
  async function png(opts: { alpha: boolean; size?: number; w?: number; h?: number }) {
    const w = opts.w ?? opts.size ?? 1200;
    const h = opts.h ?? opts.size ?? 1200;
    return sharp({
      create: {
        width: w,
        height: h,
        channels: opts.alpha ? 4 : 3,
        background: opts.alpha ? { r: 200, g: 0, b: 0, alpha: 0.5 } : { r: 200, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
  }

  it("inspects cutouts: alpha is required, size and squareness only warn", async () => {
    expect((await inspectImage(await png({ alpha: true }), "cutout")).warnings).toEqual([]);
    await expect(inspectImage(await png({ alpha: false }), "cutout")).rejects.toThrow(
      /transparency/,
    );
    const jpeg = await sharp({
      create: { width: 1300, height: 1300, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toBuffer();
    await expect(inspectImage(jpeg, "cutout")).rejects.toThrow(/PNG or WebP/);
    const small = await inspectImage(await png({ alpha: true, size: 600 }), "cutout");
    expect(small.warnings.join(" ")).toMatch(/1200px/);
    const wide = await inspectImage(await png({ alpha: true, w: 2000, h: 1300 }), "cutout");
    expect(wide.warnings.join(" ")).toMatch(/square/);
    await expect(inspectImage(Buffer.from("not an image"), "photo")).rejects.toThrow(
      /readable image/,
    );
    expect((await inspectImage(jpeg, "photo")).format).toBe("jpeg");
  });

  it("adds, edits alt, reorders and deletes image rows; alt text is required", async () => {
    const s = await setup();
    const p = await createProduct(db(), input(s), s.owner);
    const add = (path: string, alt: string) =>
      insertImageRecord(
        db(),
        { productId: p.id, kind: "photo", path, alt, width: 800, height: 800 },
        s.owner,
      );
    const a = await add("/placeholders/a.svg", "First");
    const b = await add("/placeholders/b.svg", "Second");
    const c = await add("/placeholders/c.svg", "Third");
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
    await expect(add("/placeholders/d.svg", "   ")).rejects.toBeInstanceOf(ZodError);

    await updateImageAlt(db(), b.id, "Second, edited", s.owner);
    await reorderImages(db(), p.id, "photo", [c.id, a.id, b.id], s.owner);
    await expect(reorderImages(db(), p.id, "photo", [a.id], s.owner)).rejects.toThrow(/changed/);
    let rows = await db().select().from(productImages).where(eq(productImages.productId, p.id));
    expect(rows.sort((x, y) => x.position - y.position).map((r) => r.alt)).toEqual([
      "Third",
      "First",
      "Second, edited",
    ]);

    await deleteImage(db(), a.id, s.owner);
    rows = await db().select().from(productImages).where(eq(productImages.productId, p.id));
    expect(rows.sort((x, y) => x.position - y.position).map((r) => [r.alt, r.position])).toEqual([
      ["Third", 0],
      ["Second, edited", 1],
    ]);
    await expect(deleteImage(db(), b.id, s.fulfilment)).rejects.toThrow(/Forbidden/);

    const audits = await db().select().from(adminAuditLog);
    expect(audits.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        "product.image.add",
        "product.image.update",
        "product.image.reorder",
        "product.image.delete",
      ]),
    );
  });

  it("cascades product vibes cleanup on delete-free flows (sanity: vibes rows replaced not duplicated)", async () => {
    const s = await setup();
    const p = await createProduct(db(), input(s), s.owner);
    const d = (await getAdminProduct(db(), p.id))!;
    for (let i = 0; i < 2; i++) {
      await updateProduct(
        db(),
        p.id,
        input(s, {
          variants: [
            {
              id: d.variants[0]!.id,
              sku: "skull-1",
              title: "Default",
              optionValues: [],
              pricePaise: 19900,
              mrpPaise: 24900,
              active: true,
            },
          ],
        }),
        s.owner,
      );
    }
    expect(
      await db().select().from(productVibes).where(eq(productVibes.productId, p.id)),
    ).toHaveLength(1);
  });
});
