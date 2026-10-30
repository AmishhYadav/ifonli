import "server-only";

import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";

import type { CatalogInvalidation } from "@/server/cache/tags";
import {
  inventoryMovements,
  orderItems,
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
import { assertCan } from "@/server/auth/permissions";
import { writeAudit } from "@/server/services/audit";
import { adjustStock } from "@/server/services/inventory";
import { readSettings, type DbClient } from "@/server/services/queries/shared";
import { loadVariantStock } from "@/server/services/queries/stock";

import {
  diffFields,
  productInputSchema,
  slugify,
  type ProductInput,
  type ProductStatus,
} from "./product-schema";

/** Who is performing the mutation (from `requireAdmin()` in the Server Action). */
export interface AdminActor {
  id: string;
  role: string;
  ip?: string | null;
}

export interface ProductMutationResult {
  id: string;
  slug: string;
  /** Pass to `revalidateCatalog(...)` after the transaction commits. */
  invalidation: CatalogInvalidation;
  /** True when this call wrote stock (initial stock): also call `revalidateStock`. */
  stockChanged: boolean;
}

export class ProductNotFoundError extends Error {
  constructor(readonly productId: string) {
    super(`Product ${productId} not found`);
    this.name = "ProductNotFoundError";
  }
}
export class SlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`The slug "${slug}" is already used by another product`);
    this.name = "SlugTakenError";
  }
}
export class SkuTakenError extends Error {
  constructor(readonly skus: string[]) {
    super(`SKU already in use: ${skus.join(", ")}`);
    this.name = "SkuTakenError";
  }
}
export class AdminInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminInputError";
  }
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export async function isSlugAvailable(
  db: DbClient,
  slug: string,
  excludeProductId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(
      excludeProductId
        ? and(eq(products.slug, slug), ne(products.id, excludeProductId))
        : eq(products.slug, slug),
    )
    .limit(1);
  return !row;
}

export interface ProductFormOptions {
  types: { id: string; slug: string; name: string; active: boolean }[];
  vibes: { id: string; slug: string; name: string }[];
}

export async function getProductFormOptions(db: DbClient): Promise<ProductFormOptions> {
  const [types, vibeRows] = await Promise.all([
    db
      .select({
        id: productTypes.id,
        slug: productTypes.slug,
        name: productTypes.name,
        active: productTypes.active,
      })
      .from(productTypes)
      .orderBy(asc(productTypes.sort), asc(productTypes.name)),
    db
      .select({ id: vibes.id, slug: vibes.slug, name: vibes.name })
      .from(vibes)
      .orderBy(asc(vibes.sort), asc(vibes.name)),
  ]);
  return { types, vibes: vibeRows };
}

export type StockState = "in" | "low" | "out";

export interface AdminProductRow {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  typeName: string;
  typeSlug: string;
  isKit: boolean;
  vibeNames: string[];
  vibeSlugs: string[];
  variantCount: number;
  priceFromPaise: number | null;
  priceToPaise: number | null;
  onHand: number;
  available: number;
  stock: StockState;
  image: { path: string; alt: string } | null;
  updatedAt: Date;
}

export interface ListAdminProductsParams {
  q?: string;
  vibe?: string;
  type?: string;
  status?: ProductStatus;
  stock?: StockState;
  page?: number;
  pageSize?: number;
}

export interface AdminProductList {
  items: AdminProductRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Product list for /admin/products: SQL filters, then stock state (from live availability) in memory. */
export async function listAdminProducts(
  db: DbClient,
  params: ListAdminProductsParams = {},
  now: Date = new Date(),
): Promise<AdminProductList> {
  const q = params.q?.trim();
  const conds = [
    params.status ? eq(products.status, params.status) : undefined,
    params.type ? eq(productTypes.slug, params.type) : undefined,
    params.vibe
      ? sql`exists (select 1 from product_vibes pv join vibes vb on vb.id = pv.vibe_id where pv.product_id = ${products.id} and vb.slug = ${params.vibe})`
      : undefined,
    q
      ? or(
          ilike(products.name, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`),
          ilike(products.slug, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`),
          sql`exists (select 1 from variants v where v.product_id = ${products.id} and v.sku ilike ${`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`})`,
        )
      : undefined,
  ].filter((c) => c !== undefined);

  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      status: products.status,
      isKit: products.isKit,
      typeName: productTypes.name,
      typeSlug: productTypes.slug,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .innerJoin(productTypes, eq(products.typeId, productTypes.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(products.updatedAt), asc(products.name));

  const ids = rows.map((r) => r.id);
  const [vibeRows, variantRows, imageRows, settingsRead] = ids.length
    ? await Promise.all([
        db
          .select({
            productId: productVibes.productId,
            name: vibes.name,
            slug: vibes.slug,
            sort: vibes.sort,
          })
          .from(productVibes)
          .innerJoin(vibes, eq(productVibes.vibeId, vibes.id))
          .where(inArray(productVibes.productId, ids))
          .orderBy(asc(vibes.sort)),
        db
          .select({
            id: variants.id,
            productId: variants.productId,
            pricePaise: variants.pricePaise,
            active: variants.active,
          })
          .from(variants)
          .where(inArray(variants.productId, ids)),
        db
          .select({
            productId: productImages.productId,
            kind: productImages.kind,
            path: productImages.path,
            alt: productImages.alt,
            position: productImages.position,
          })
          .from(productImages)
          .where(inArray(productImages.productId, ids))
          .orderBy(asc(productImages.position)),
        readSettings(db, ["default_low_stock_threshold"]),
      ])
    : [[], [], [], await readSettings(db, ["default_low_stock_threshold"])];

  const stockRows = await loadVariantStock(
    db,
    variantRows.map((v) => v.id),
    now,
  );
  const stockByVariant = new Map(stockRows.map((s) => [s.variantId, s]));
  const defaultThreshold = settingsRead.default_low_stock_threshold.value;

  const vibesByProduct = new Map<string, { name: string; slug: string }[]>();
  for (const v of vibeRows) {
    const list = vibesByProduct.get(v.productId) ?? [];
    list.push({ name: v.name, slug: v.slug });
    vibesByProduct.set(v.productId, list);
  }
  const variantsByProduct = new Map<string, typeof variantRows>();
  for (const v of variantRows) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push(v);
    variantsByProduct.set(v.productId, list);
  }
  const imageByProduct = new Map<string, { path: string; alt: string }>();
  for (const kind of ["photo", "cutout"] as const) {
    for (const img of imageRows) {
      if (img.kind === kind && !imageByProduct.has(img.productId)) {
        imageByProduct.set(img.productId, { path: img.path, alt: img.alt });
      }
    }
  }

  let items: AdminProductRow[] = rows.map((r) => {
    const vs = variantsByProduct.get(r.id) ?? [];
    const active = vs.filter((v) => v.active);
    const prices = (active.length ? active : vs).map((v) => v.pricePaise);
    let onHand = 0;
    let available = 0;
    let anyInStock = false;
    let allLow = active.length > 0;
    for (const v of vs) {
      const s = stockByVariant.get(v.id);
      if (!s) continue;
      onHand += s.onHand;
      if (!v.active) continue;
      available += s.available;
      if (s.available > 0) anyInStock = true;
      if (s.available > (s.lowStockThreshold ?? defaultThreshold)) allLow = false;
    }
    const stock: StockState = !anyInStock ? "out" : allLow ? "low" : "in";
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      typeName: r.typeName,
      typeSlug: r.typeSlug,
      isKit: r.isKit,
      vibeNames: (vibesByProduct.get(r.id) ?? []).map((v) => v.name),
      vibeSlugs: (vibesByProduct.get(r.id) ?? []).map((v) => v.slug),
      variantCount: vs.length,
      priceFromPaise: prices.length ? Math.min(...prices) : null,
      priceToPaise: prices.length ? Math.max(...prices) : null,
      onHand,
      available,
      stock,
      image: imageByProduct.get(r.id) ?? null,
      updatedAt: r.updatedAt,
    };
  });
  if (params.stock) items = items.filter((i) => i.stock === params.stock);

  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 5000);
  const total = items.length;
  const page = Math.min(Math.max(params.page ?? 1, 1), Math.max(1, Math.ceil(total / pageSize)));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
}

export interface AdminProductDetail {
  id: string;
  slug: string;
  name: string;
  descriptionMd: string | null;
  typeId: string;
  status: ProductStatus;
  isKit: boolean;
  seoTitle: string | null;
  seoDesc: string | null;
  hsnCode: string | null;
  gstRateBp: number | null;
  countryOfOrigin: string | null;
  netQuantity: string | null;
  dimensions: string | null;
  manufacturerOverride: { name: string; address: string } | null;
  createdAt: Date;
  updatedAt: Date;
  vibes: { vibeId: string; featuredRank: number | null }[];
  options: {
    id: string;
    name: string;
    values: { id: string; value: string; swatchHex: string | null }[];
  }[];
  variants: {
    id: string;
    sku: string;
    title: string;
    optionValues: string[];
    pricePaise: number;
    mrpPaise: number;
    weightG: number | null;
    lowStockThreshold: number | null;
    active: boolean;
    onHand: number;
    available: number;
    /** Has stock movements, order lines or reservations: cannot be deleted, only deactivated. */
    hasHistory: boolean;
  }[];
  images: {
    id: string;
    kind: "photo" | "cutout";
    path: string;
    alt: string;
    width: number | null;
    height: number | null;
    position: number;
    isPlaceholder: boolean;
  }[];
}

export async function getAdminProduct(
  db: DbClient,
  id: string,
  now: Date = new Date(),
): Promise<AdminProductDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await db.select().from(products).where(eq(products.id, id));
  if (!p) return null;
  const [vibeRows, optionRows, variantRows, imageRows] = await Promise.all([
    db.select().from(productVibes).where(eq(productVibes.productId, id)),
    db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, id))
      .orderBy(asc(productOptions.position), asc(productOptions.name)),
    db
      .select()
      .from(variants)
      .where(eq(variants.productId, id))
      .orderBy(asc(variants.position), asc(variants.sku)),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.kind), asc(productImages.position)),
  ]);
  const optionIds = optionRows.map((o) => o.id);
  const valueRows = optionIds.length
    ? await db
        .select()
        .from(productOptionValues)
        .where(inArray(productOptionValues.optionId, optionIds))
        .orderBy(asc(productOptionValues.position), asc(productOptionValues.value))
    : [];
  const variantIds = variantRows.map((v) => v.id);
  const stock = await loadVariantStock(db, variantIds, now);
  const stockById = new Map(stock.map((s) => [s.variantId, s]));
  const history = variantIds.length ? await variantsWithHistory(db, variantIds) : new Set<string>();

  const valueLabel = new Map(valueRows.map((v) => [v.id, v]));
  const options = optionRows.map((o) => ({
    id: o.id,
    name: o.name,
    values: valueRows
      .filter((v) => v.optionId === o.id)
      .map((v) => ({ id: v.id, value: v.value, swatchHex: v.swatchHex })),
  }));
  const manufacturer = p.manufacturerOverride as { name?: unknown; address?: unknown } | null;

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    descriptionMd: p.descriptionMd,
    typeId: p.typeId,
    status: p.status,
    isKit: p.isKit,
    seoTitle: p.seoTitle,
    seoDesc: p.seoDesc,
    hsnCode: p.hsnCode,
    gstRateBp: p.gstRateBp,
    countryOfOrigin: p.countryOfOrigin,
    netQuantity: p.netQuantity,
    dimensions: p.dimensions,
    manufacturerOverride:
      manufacturer &&
      typeof manufacturer.name === "string" &&
      typeof manufacturer.address === "string"
        ? { name: manufacturer.name, address: manufacturer.address }
        : null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    vibes: vibeRows.map((v) => ({ vibeId: v.vibeId, featuredRank: v.featuredRank })),
    options,
    variants: variantRows.map((v) => {
      const byOption = new Map<string, string>();
      for (const valueId of v.optionValueIds) {
        const val = valueLabel.get(valueId);
        if (val) byOption.set(val.optionId, val.value);
      }
      return {
        id: v.id,
        sku: v.sku,
        title: v.title,
        optionValues: options.map((o) => byOption.get(o.id) ?? ""),
        pricePaise: v.pricePaise,
        mrpPaise: v.mrpPaise,
        weightG: v.weightG,
        lowStockThreshold: v.lowStockThreshold,
        active: v.active,
        onHand: stockById.get(v.id)?.onHand ?? v.stockOnHand,
        available: stockById.get(v.id)?.available ?? v.stockOnHand,
        hasHistory: history.has(v.id),
      };
    }),
    images: imageRows.map((i) => ({
      id: i.id,
      kind: i.kind,
      path: i.path,
      alt: i.alt,
      width: i.width,
      height: i.height,
      position: i.position,
      isPlaceholder: i.isPlaceholder,
    })),
  };
}

async function variantsWithHistory(db: DbClient, variantIds: string[]): Promise<Set<string>> {
  const [moves, items, reservations] = await Promise.all([
    db
      .selectDistinct({ id: inventoryMovements.variantId })
      .from(inventoryMovements)
      .where(inArray(inventoryMovements.variantId, variantIds)),
    db
      .selectDistinct({ id: orderItems.variantId })
      .from(orderItems)
      .where(inArray(orderItems.variantId, variantIds)),
    db
      .selectDistinct({ id: stockReservations.variantId })
      .from(stockReservations)
      .where(inArray(stockReservations.variantId, variantIds)),
  ]);
  return new Set([...moves, ...items, ...reservations].map((r) => r.id));
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

async function assertRefsExist(
  db: DbClient,
  input: ProductInput,
): Promise<{ typeSlug: string; vibeSlugs: string[] }> {
  const [type] = await db
    .select({ slug: productTypes.slug })
    .from(productTypes)
    .where(eq(productTypes.id, input.typeId));
  if (!type) throw new AdminInputError("Unknown product type");
  const vibeIds = input.vibes.map((v) => v.vibeId);
  const vibeRows = vibeIds.length
    ? await db
        .select({ id: vibes.id, slug: vibes.slug })
        .from(vibes)
        .where(inArray(vibes.id, vibeIds))
    : [];
  if (vibeRows.length !== vibeIds.length) throw new AdminInputError("Unknown vibe");
  return { typeSlug: type.slug, vibeSlugs: vibeRows.map((v) => v.slug) };
}

async function assertSkusFree(db: DbClient, input: ProductInput, productId?: string) {
  const skus = input.variants.map((v) => v.sku);
  const taken = await db
    .select({ id: variants.id, sku: variants.sku, productId: variants.productId })
    .from(variants)
    .where(inArray(variants.sku, skus));
  const ownIds = new Set(input.variants.map((v) => v.id).filter((x): x is string => !!x));
  const conflicts = taken.filter(
    (t) => !(productId && t.productId === productId && ownIds.has(t.id)),
  );
  if (conflicts.length) throw new SkuTakenError(conflicts.map((c) => c.sku));
}

/** Maps Postgres unique violations from a write to friendly typed errors. */
function rethrowUnique(error: unknown, input: ProductInput): never {
  let e: unknown = error;
  while (e && typeof e === "object") {
    const code = (e as { code?: string }).code;
    const constraint = (e as { constraint_name?: string }).constraint_name ?? "";
    if (code === "23505") {
      if (constraint.includes("slug")) throw new SlugTakenError(input.slug);
      if (constraint.includes("sku")) throw new SkuTakenError(input.variants.map((v) => v.sku));
    }
    e = (e as { cause?: unknown }).cause;
  }
  throw error;
}

interface SyncedOptions {
  /** `optionIndex:valueLabelLower` -> option value id */
  valueIds: Map<string, string>;
}

/** Brings the product's options and values in line with the payload (ids kept for edits). */
async function syncOptions(
  tx: DbClient,
  productId: string,
  input: ProductInput,
): Promise<SyncedOptions> {
  const existingOptions = await tx
    .select()
    .from(productOptions)
    .where(eq(productOptions.productId, productId));
  const keepOptionIds = new Set(input.options.map((o) => o.id).filter((x): x is string => !!x));
  const removedOptions = existingOptions.filter((o) => !keepOptionIds.has(o.id)).map((o) => o.id);
  if (removedOptions.length) {
    await tx.delete(productOptions).where(inArray(productOptions.id, removedOptions));
  }
  const valueIds = new Map<string, string>();
  for (const [oi, option] of input.options.entries()) {
    const own =
      option.id && existingOptions.some((o) => o.id === option.id) ? option.id : undefined;
    let optionId: string;
    if (own) {
      optionId = own;
      await tx
        .update(productOptions)
        .set({ name: option.name, position: oi })
        .where(eq(productOptions.id, own));
      const existingValues = await tx
        .select({ id: productOptionValues.id })
        .from(productOptionValues)
        .where(eq(productOptionValues.optionId, own));
      const keep = new Set(option.values.map((v) => v.id).filter((x): x is string => !!x));
      const removed = existingValues.filter((v) => !keep.has(v.id)).map((v) => v.id);
      if (removed.length) {
        await tx.delete(productOptionValues).where(inArray(productOptionValues.id, removed));
      }
    } else {
      const [row] = await tx
        .insert(productOptions)
        .values({ productId, name: option.name, position: oi })
        .returning({ id: productOptions.id });
      optionId = row!.id;
    }
    const existingValueIds = new Set(
      (
        await tx
          .select({ id: productOptionValues.id })
          .from(productOptionValues)
          .where(eq(productOptionValues.optionId, optionId))
      ).map((v) => v.id),
    );
    for (const [vi, value] of option.values.entries()) {
      let id = value.id && existingValueIds.has(value.id) ? value.id : undefined;
      if (id) {
        await tx
          .update(productOptionValues)
          .set({ value: value.value, swatchHex: value.swatchHex, position: vi })
          .where(eq(productOptionValues.id, id));
      } else {
        const [row] = await tx
          .insert(productOptionValues)
          .values({ optionId, value: value.value, swatchHex: value.swatchHex, position: vi })
          .returning({ id: productOptionValues.id });
        id = row!.id;
      }
      valueIds.set(`${oi}:${value.value.toLowerCase()}`, id);
    }
  }
  return { valueIds };
}

interface VariantSyncResult {
  added: string[];
  removed: string[];
  deactivated: string[];
  changed: { sku: string; fields: Record<string, { from: unknown; to: unknown }> }[];
  stockWritten: boolean;
}

async function syncVariants(
  tx: DbClient,
  productId: string,
  input: ProductInput,
  synced: SyncedOptions,
  actor: AdminActor,
): Promise<VariantSyncResult> {
  const existing = await tx.select().from(variants).where(eq(variants.productId, productId));
  const existingById = new Map(existing.map((v) => [v.id, v]));
  const result: VariantSyncResult = {
    added: [],
    removed: [],
    deactivated: [],
    changed: [],
    stockWritten: false,
  };

  for (const v of input.variants) {
    if (v.id && !existingById.has(v.id))
      throw new AdminInputError("A variant does not belong to this product");
  }

  // Variants dropped from the form: delete if they have no history, else just deactivate.
  const keep = new Set(input.variants.map((v) => v.id).filter((x): x is string => !!x));
  const dropped = existing.filter((v) => !keep.has(v.id));
  if (dropped.length) {
    const history = await variantsWithHistory(
      tx,
      dropped.map((v) => v.id),
    );
    for (const v of dropped) {
      if (history.has(v.id)) {
        if (v.active) await tx.update(variants).set({ active: false }).where(eq(variants.id, v.id));
        result.deactivated.push(v.sku);
      } else {
        await tx.delete(variants).where(eq(variants.id, v.id));
        result.removed.push(v.sku);
      }
    }
  }

  for (const [position, v] of input.variants.entries()) {
    const optionValueIds = v.optionValues.map((label, oi) => {
      const id = synced.valueIds.get(`${oi}:${label.toLowerCase()}`);
      if (!id) throw new AdminInputError(`Unknown option value "${label}"`);
      return id;
    });
    const values = {
      sku: v.sku,
      title: v.title,
      optionValueIds,
      pricePaise: v.pricePaise,
      mrpPaise: v.mrpPaise,
      weightG: v.weightG,
      lowStockThreshold: v.lowStockThreshold,
      active: v.active,
      position,
    };
    if (v.id) {
      const before = existingById.get(v.id)!;
      const fields = diffFields(
        {
          sku: before.sku,
          title: before.title,
          pricePaise: before.pricePaise,
          mrpPaise: before.mrpPaise,
          weightG: before.weightG,
          lowStockThreshold: before.lowStockThreshold,
          active: before.active,
          position: before.position,
        },
        {
          sku: v.sku,
          title: v.title,
          pricePaise: v.pricePaise,
          mrpPaise: v.mrpPaise,
          weightG: v.weightG,
          lowStockThreshold: v.lowStockThreshold,
          active: v.active,
          position,
        },
      );
      await tx.update(variants).set(values).where(eq(variants.id, v.id));
      if (Object.keys(fields).length) result.changed.push({ sku: v.sku, fields });
    } else {
      const [row] = await tx
        .insert(variants)
        .values({ productId, ...values, stockOnHand: 0 })
        .returning({ id: variants.id });
      result.added.push(v.sku);
      if (v.initialStock > 0) {
        // Through the ledger so on-hand and movements never drift.
        await adjustStock(
          {
            variantId: row!.id,
            delta: v.initialStock,
            reason: "restock",
            actorId: actor.id,
            note: "Initial stock",
          },
          tx,
        );
        result.stockWritten = true;
      }
    }
  }
  return result;
}

function productColumns(input: ProductInput) {
  return {
    slug: input.slug,
    name: input.name,
    descriptionMd: input.descriptionMd,
    typeId: input.typeId,
    status: input.status,
    isKit: input.isKit,
    seoTitle: input.seoTitle,
    seoDesc: input.seoDesc,
    hsnCode: input.hsnCode,
    gstRateBp: input.gstRateBp,
    countryOfOrigin: input.countryOfOrigin,
    netQuantity: input.netQuantity,
    dimensions: input.dimensions,
    manufacturerOverride: input.manufacturerOverride,
  };
}

export async function createProduct(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<ProductMutationResult> {
  assertCan(actor.role, "product:create");
  const input = productInputSchema.parse(raw);
  const refs = await assertRefsExist(db, input);
  if (!(await isSlugAvailable(db, input.slug))) throw new SlugTakenError(input.slug);
  await assertSkusFree(db, input);

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(products)
        .values(productColumns(input))
        .returning({ id: products.id });
      const id = row!.id;
      const synced = await syncOptions(tx, id, input);
      if (input.vibes.length) {
        await tx.insert(productVibes).values(
          input.vibes.map((v) => ({
            productId: id,
            vibeId: v.vibeId,
            featuredRank: v.featuredRank,
          })),
        );
      }
      const vs = await syncVariants(tx, id, input, synced, actor);
      await writeAudit(tx, {
        actorId: actor.id,
        action: "product.create",
        entity: "product",
        entityId: id,
        diff: {
          name: input.name,
          slug: input.slug,
          status: input.status,
          variants: vs.added,
        },
        ip: actor.ip,
      });
      return {
        id,
        slug: input.slug,
        stockChanged: vs.stockWritten,
        invalidation: {
          productIds: [id],
          productSlugs: [input.slug],
          vibeSlugs: refs.vibeSlugs,
          typeSlugs: [refs.typeSlug],
        },
      };
    });
  } catch (error) {
    rethrowUnique(error, input);
  }
}

export async function updateProduct(
  db: DbClient,
  productId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<ProductMutationResult> {
  assertCan(actor.role, "product:update");
  const input = productInputSchema.parse(raw);
  const refs = await assertRefsExist(db, input);
  if (!(await isSlugAvailable(db, input.slug, productId))) throw new SlugTakenError(input.slug);
  await assertSkusFree(db, input, productId);

  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .for("update");
      if (!before) throw new ProductNotFoundError(productId);
      const [oldType] = await tx
        .select({ slug: productTypes.slug })
        .from(productTypes)
        .where(eq(productTypes.id, before.typeId));
      const oldVibes = await tx
        .select({ slug: vibes.slug })
        .from(productVibes)
        .innerJoin(vibes, eq(productVibes.vibeId, vibes.id))
        .where(eq(productVibes.productId, productId));

      const cols = productColumns(input);
      const beforeCols = {
        slug: before.slug,
        name: before.name,
        descriptionMd: before.descriptionMd,
        typeId: before.typeId,
        status: before.status,
        isKit: before.isKit,
        seoTitle: before.seoTitle,
        seoDesc: before.seoDesc,
        hsnCode: before.hsnCode,
        gstRateBp: before.gstRateBp,
        countryOfOrigin: before.countryOfOrigin,
        netQuantity: before.netQuantity,
        dimensions: before.dimensions,
        manufacturerOverride: before.manufacturerOverride,
      };
      const productDiff = diffFields(beforeCols, cols);
      await tx.update(products).set(cols).where(eq(products.id, productId));

      const oldVibeRows = await tx
        .select()
        .from(productVibes)
        .where(eq(productVibes.productId, productId));
      await tx.delete(productVibes).where(eq(productVibes.productId, productId));
      if (input.vibes.length) {
        await tx
          .insert(productVibes)
          .values(
            input.vibes.map((v) => ({ productId, vibeId: v.vibeId, featuredRank: v.featuredRank })),
          );
      }
      const vibeDiff = diffFields(
        { vibes: oldVibeRows.map((v) => [v.vibeId, v.featuredRank]).sort() },
        { vibes: input.vibes.map((v) => [v.vibeId, v.featuredRank]).sort() },
      );

      const synced = await syncOptions(tx, productId, input);
      const vs = await syncVariants(tx, productId, input, synced, actor);

      await writeAudit(tx, {
        actorId: actor.id,
        action: "product.update",
        entity: "product",
        entityId: productId,
        diff: {
          ...productDiff,
          ...vibeDiff,
          variants: {
            added: vs.added,
            removed: vs.removed,
            deactivated: vs.deactivated,
            changed: vs.changed,
          },
        },
        ip: actor.ip,
      });
      return {
        id: productId,
        slug: input.slug,
        stockChanged: vs.stockWritten,
        invalidation: {
          productIds: [productId],
          productSlugs: [...new Set([before.slug, input.slug])],
          vibeSlugs: [...new Set([...oldVibes.map((v) => v.slug), ...refs.vibeSlugs])],
          typeSlugs: [...new Set([...(oldType ? [oldType.slug] : []), refs.typeSlug])],
        },
      };
    });
  } catch (error) {
    rethrowUnique(error, input);
  }
}

/** Archive / unarchive / publish / unpublish. Archiving needs `product:archive`. */
export async function setProductStatus(
  db: DbClient,
  productId: string,
  status: ProductStatus,
  actor: AdminActor,
): Promise<ProductMutationResult> {
  assertCan(actor.role, status === "archived" ? "product:archive" : "product:update");
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .for("update");
    if (!before) throw new ProductNotFoundError(productId);
    if (status === "active") {
      const [anyActive] = await tx
        .select({ id: variants.id })
        .from(variants)
        .where(and(eq(variants.productId, productId), eq(variants.active, true)))
        .limit(1);
      if (!anyActive) throw new AdminInputError("Activate at least one variant before publishing");
    }
    await tx.update(products).set({ status }).where(eq(products.id, productId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: status === "archived" ? "product.archive" : "product.status",
      entity: "product",
      entityId: productId,
      diff: { status: { from: before.status, to: status } },
      ip: actor.ip,
    });
    return {
      id: productId,
      slug: before.slug,
      stockChanged: false,
      invalidation: await invalidationFor(tx, productId, [before.slug]),
    };
  });
}

export async function invalidationFor(
  db: DbClient,
  productId: string,
  slugs: string[],
): Promise<CatalogInvalidation> {
  const [type] = await db
    .select({ slug: productTypes.slug })
    .from(products)
    .innerJoin(productTypes, eq(products.typeId, productTypes.id))
    .where(eq(products.id, productId));
  const vibeRows = await db
    .select({ slug: vibes.slug })
    .from(productVibes)
    .innerJoin(vibes, eq(productVibes.vibeId, vibes.id))
    .where(eq(productVibes.productId, productId));
  return {
    productIds: [productId],
    productSlugs: slugs,
    vibeSlugs: vibeRows.map((v) => v.slug),
    typeSlugs: type ? [type.slug] : [],
  };
}

async function uniqueCopySlug(db: DbClient, base: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = slugify(n === 1 ? `${base}-copy` : `${base}-copy-${n}`);
    if (await isSlugAvailable(db, candidate)) return candidate;
  }
  throw new AdminInputError("Could not find a free slug for the copy");
}

async function uniqueCopySku(db: DbClient, sku: string, taken: Set<string>): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? `${sku}-COPY` : `${sku}-COPY${n}`;
    if (taken.has(candidate)) continue;
    const [row] = await db
      .select({ id: variants.id })
      .from(variants)
      .where(eq(variants.sku, candidate))
      .limit(1);
    if (!row) return candidate;
  }
  throw new AdminInputError("Could not find a free SKU for the copy");
}

/** Copies a product as a draft: options, variants (zero stock, new SKUs), vibes, images. */
export async function duplicateProduct(
  db: DbClient,
  productId: string,
  actor: AdminActor,
): Promise<ProductMutationResult> {
  assertCan(actor.role, "product:create");
  return db.transaction(async (tx) => {
    const [src] = await tx.select().from(products).where(eq(products.id, productId));
    if (!src) throw new ProductNotFoundError(productId);
    const slug = await uniqueCopySlug(tx, src.slug);
    const [copy] = await tx
      .insert(products)
      .values({
        slug,
        name: `${src.name} (copy)`.slice(0, 200),
        descriptionMd: src.descriptionMd,
        typeId: src.typeId,
        status: "draft",
        seoTitle: src.seoTitle,
        seoDesc: src.seoDesc,
        hsnCode: src.hsnCode,
        gstRateBp: src.gstRateBp,
        countryOfOrigin: src.countryOfOrigin,
        netQuantity: src.netQuantity,
        dimensions: src.dimensions,
        manufacturerOverride: src.manufacturerOverride,
        isKit: src.isKit,
      })
      .returning({ id: products.id });
    const newId = copy!.id;

    const srcVibes = await tx
      .select()
      .from(productVibes)
      .where(eq(productVibes.productId, productId));
    if (srcVibes.length) {
      // Copies start unfeatured: they must not displace the original in featured sets.
      await tx
        .insert(productVibes)
        .values(srcVibes.map((v) => ({ productId: newId, vibeId: v.vibeId, featuredRank: null })));
    }

    const valueIdMap = new Map<string, string>();
    const srcOptions = await tx
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, productId));
    for (const o of srcOptions) {
      const [no] = await tx
        .insert(productOptions)
        .values({ productId: newId, name: o.name, position: o.position })
        .returning({ id: productOptions.id });
      const vals = await tx
        .select()
        .from(productOptionValues)
        .where(eq(productOptionValues.optionId, o.id));
      for (const v of vals) {
        const [nv] = await tx
          .insert(productOptionValues)
          .values({
            optionId: no!.id,
            value: v.value,
            swatchHex: v.swatchHex,
            position: v.position,
          })
          .returning({ id: productOptionValues.id });
        valueIdMap.set(v.id, nv!.id);
      }
    }

    const srcVariants = await tx
      .select()
      .from(variants)
      .where(eq(variants.productId, productId))
      .orderBy(asc(variants.position));
    const takenSkus = new Set<string>();
    const variantIdMap = new Map<string, string>();
    for (const v of srcVariants) {
      const sku = await uniqueCopySku(tx, v.sku, takenSkus);
      takenSkus.add(sku);
      const [nv] = await tx
        .insert(variants)
        .values({
          productId: newId,
          sku,
          title: v.title,
          optionValueIds: v.optionValueIds.map((id) => valueIdMap.get(id) ?? id),
          pricePaise: v.pricePaise,
          mrpPaise: v.mrpPaise,
          stockOnHand: 0,
          lowStockThreshold: v.lowStockThreshold,
          weightG: v.weightG,
          active: v.active,
          position: v.position,
        })
        .returning({ id: variants.id });
      variantIdMap.set(v.id, nv!.id);
    }

    const srcImages = await tx
      .select()
      .from(productImages)
      .where(eq(productImages.productId, productId));
    if (srcImages.length) {
      await tx.insert(productImages).values(
        srcImages.map((i) => ({
          productId: newId,
          variantId: i.variantId ? (variantIdMap.get(i.variantId) ?? null) : null,
          kind: i.kind,
          path: i.path,
          alt: i.alt,
          width: i.width,
          height: i.height,
          position: i.position,
          isPlaceholder: i.isPlaceholder,
        })),
      );
    }

    await writeAudit(tx, {
      actorId: actor.id,
      action: "product.duplicate",
      entity: "product",
      entityId: newId,
      diff: { from: productId, slug },
      ip: actor.ip,
    });
    return {
      id: newId,
      slug,
      stockChanged: false,
      invalidation: await invalidationFor(tx, newId, [slug]),
    };
  });
}
