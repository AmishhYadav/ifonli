import "server-only";

import { and, asc, eq, max } from "drizzle-orm";
import sharp, { type Metadata } from "sharp";

import { productImages, products, variants } from "@/server/db/schema";
import { assertCan } from "@/server/auth/permissions";
import { writeAudit } from "@/server/services/audit";
import type { DbClient } from "@/server/services/queries/shared";
import { createSignedUploadUrl, type SignedUpload } from "@/server/storage";

import {
  AdminInputError,
  ProductNotFoundError,
  invalidationFor,
  type AdminActor,
} from "./products";
import { altTextSchema } from "./product-schema";
import { deleteStorageObjects, readPublicObject } from "./storage";

export type ImageKind = "photo" | "cutout";

const BUCKET: Record<ImageKind, "products" | "cutouts"> = { photo: "products", cutout: "cutouts" };
const PHOTO_FORMATS = ["jpeg", "png", "webp", "avif"];
const CUTOUT_FORMATS = ["png", "webp"];
export const CUTOUT_MIN_PX = 1200;
const SQUARE_TOLERANCE = 0.15;

export interface ImageInspection {
  format: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  /** Non-blocking advice shown to the admin. */
  warnings: string[];
}

/**
 * Validates an uploaded image's bytes. Hard errors (throws `AdminInputError`): unreadable file,
 * wrong format, and (cutouts) no alpha channel. Soft warnings: cutout below 1200 px or not roughly
 * square, photo very small.
 */
export async function inspectImage(buffer: Buffer, kind: ImageKind): Promise<ImageInspection> {
  let meta: Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new AdminInputError("That file is not a readable image");
  }
  const format = meta.format ?? "";
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const hasAlpha = meta.hasAlpha === true;
  if (!width || !height) throw new AdminInputError("Could not read the image size");

  const warnings: string[] = [];
  if (kind === "cutout") {
    if (!CUTOUT_FORMATS.includes(format)) {
      throw new AdminInputError("Cutouts must be PNG or WebP with a transparent background");
    }
    if (!hasAlpha) {
      throw new AdminInputError(
        "This cutout has no transparency (alpha channel). Export it with a transparent background",
      );
    }
    if (Math.min(width, height) < CUTOUT_MIN_PX) {
      warnings.push(`Cutout is ${width}×${height}px; 1200px or more on each side is recommended`);
    }
    if (Math.abs(width / height - 1) > SQUARE_TOLERANCE) {
      warnings.push("Cutout is not roughly square; it may be cropped on the storefront");
    }
  } else {
    if (!PHOTO_FORMATS.includes(format))
      throw new AdminInputError("Photos must be JPEG, PNG, WebP or AVIF");
    if (Math.min(width, height) < 600) warnings.push(`Photo is only ${width}×${height}px`);
  }
  return { format, width, height, hasAlpha, warnings };
}

const ALLOWED_EXT: Record<ImageKind, string[]> = {
  photo: ["jpg", "jpeg", "png", "webp", "avif"],
  cutout: ["png", "webp"],
};

export interface PreparedUpload extends SignedUpload {
  /** Value to store in `product_images.path` (`bucket/object-path`). */
  dbPath: string;
}

/** Step 1 of an upload: a signed URL the browser PUTs the file to. Nothing is recorded yet. */
export async function prepareImageUpload(
  db: DbClient,
  input: { productId: string; kind: ImageKind; extension: string },
  actor: AdminActor,
): Promise<PreparedUpload> {
  assertCan(actor.role, "product:update");
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!p) throw new ProductNotFoundError(input.productId);
  const ext = input.extension.toLowerCase().replace(/^\./, "");
  if (!ALLOWED_EXT[input.kind].includes(ext)) {
    throw new AdminInputError(
      input.kind === "cutout"
        ? "Cutouts must be PNG or WebP"
        : "Photos must be JPEG, PNG, WebP or AVIF",
    );
  }
  const objectPath = `${input.productId}/${crypto.randomUUID()}.${ext}`;
  const upload = await createSignedUploadUrl(BUCKET[input.kind], objectPath);
  return { ...upload, dbPath: `${BUCKET[input.kind]}/${objectPath}` };
}

export interface ImageRow {
  id: string;
  kind: ImageKind;
  path: string;
  alt: string;
  width: number | null;
  height: number | null;
  position: number;
  isPlaceholder: boolean;
}

export interface ImageMutationResult {
  image?: ImageRow;
  warnings: string[];
  invalidation: Awaited<ReturnType<typeof invalidationFor>>;
}

/** Inserts the DB row for an image already in storage (after validation). */
export async function insertImageRecord(
  db: DbClient,
  input: {
    productId: string;
    kind: ImageKind;
    path: string;
    alt: string;
    width: number | null;
    height: number | null;
    variantId?: string | null;
  },
  actor: AdminActor,
): Promise<ImageRow> {
  assertCan(actor.role, "product:update");
  const alt = altTextSchema.parse(input.alt);
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, input.productId));
    if (!p) throw new ProductNotFoundError(input.productId);
    if (input.variantId) {
      const [v] = await tx
        .select({ id: variants.id })
        .from(variants)
        .where(and(eq(variants.id, input.variantId), eq(variants.productId, input.productId)));
      if (!v) throw new AdminInputError("Variant does not belong to this product");
    }
    const [last] = await tx
      .select({ pos: max(productImages.position) })
      .from(productImages)
      .where(and(eq(productImages.productId, input.productId), eq(productImages.kind, input.kind)));
    const [row] = await tx
      .insert(productImages)
      .values({
        productId: input.productId,
        variantId: input.variantId ?? null,
        kind: input.kind,
        path: input.path,
        alt,
        width: input.width,
        height: input.height,
        position: (last?.pos ?? -1) + 1,
      })
      .returning();
    await writeAudit(tx, {
      actorId: actor.id,
      action: "product.image.add",
      entity: "product",
      entityId: input.productId,
      diff: { kind: input.kind, path: input.path, alt },
      ip: actor.ip,
    });
    return toImageRow(row!);
  });
}

function toImageRow(r: typeof productImages.$inferSelect): ImageRow {
  return {
    id: r.id,
    kind: r.kind,
    path: r.path,
    alt: r.alt,
    width: r.width,
    height: r.height,
    position: r.position,
    isPlaceholder: r.isPlaceholder,
  };
}

/**
 * Step 2 of an upload: reads the uploaded object back, validates it (deleting the object if it is
 * not acceptable) and records it with required alt text.
 */
export async function registerUploadedImage(
  db: DbClient,
  input: {
    productId: string;
    kind: ImageKind;
    dbPath: string;
    alt: string;
    variantId?: string | null;
  },
  actor: AdminActor,
): Promise<ImageMutationResult> {
  assertCan(actor.role, "product:update");
  const bucket = BUCKET[input.kind];
  const prefix = `${bucket}/${input.productId}/`;
  if (!input.dbPath.startsWith(prefix) || input.dbPath.includes("..")) {
    throw new AdminInputError("Unexpected upload path");
  }
  const objectPath = input.dbPath.slice(bucket.length + 1);
  altTextSchema.parse(input.alt);
  let inspection: ImageInspection;
  try {
    inspection = await inspectImage(await readPublicObject(bucket, objectPath), input.kind);
  } catch (error) {
    await deleteStorageObjects(bucket, [objectPath]).catch(() => undefined);
    throw error;
  }
  const image = await insertImageRecord(
    db,
    {
      productId: input.productId,
      kind: input.kind,
      path: input.dbPath,
      alt: input.alt,
      width: inspection.width,
      height: inspection.height,
      variantId: input.variantId,
    },
    actor,
  );
  return {
    image,
    warnings: inspection.warnings,
    invalidation: await invalidationFor(db, input.productId, []),
  };
}

export async function updateImageAlt(
  db: DbClient,
  imageId: string,
  altText: string,
  actor: AdminActor,
): Promise<ImageMutationResult> {
  assertCan(actor.role, "product:update");
  const alt = altTextSchema.parse(altText);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(productImages)
      .where(eq(productImages.id, imageId))
      .for("update");
    if (!before) throw new AdminInputError("Image not found");
    await tx.update(productImages).set({ alt }).where(eq(productImages.id, imageId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "product.image.update",
      entity: "product",
      entityId: before.productId,
      diff: { imageId, alt: { from: before.alt, to: alt } },
      ip: actor.ip,
    });
    return { warnings: [], invalidation: await invalidationFor(tx, before.productId, []) };
  });
}

/** Persists a new order for one kind of image (`orderedIds` must be exactly that kind's images). */
export async function reorderImages(
  db: DbClient,
  productId: string,
  kind: ImageKind,
  orderedIds: string[],
  actor: AdminActor,
): Promise<ImageMutationResult> {
  assertCan(actor.role, "product:update");
  return db.transaction(async (tx) => {
    const current = await tx
      .select({ id: productImages.id })
      .from(productImages)
      .where(and(eq(productImages.productId, productId), eq(productImages.kind, kind)))
      .orderBy(asc(productImages.position));
    const a = [...current.map((c) => c.id)].sort().join(",");
    const b = [...orderedIds].sort().join(",");
    if (a !== b) throw new AdminInputError("The image list changed; reload and try again");
    for (const [position, id] of orderedIds.entries()) {
      await tx.update(productImages).set({ position }).where(eq(productImages.id, id));
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "product.image.reorder",
      entity: "product",
      entityId: productId,
      diff: { kind, order: orderedIds },
      ip: actor.ip,
    });
    return { warnings: [], invalidation: await invalidationFor(tx, productId, []) };
  });
}

/**
 * Deletes the image row, then the storage object if no other row (for example a duplicated
 * product) still points at it. Site-relative placeholder paths have no object.
 */
export async function deleteImage(
  db: DbClient,
  imageId: string,
  actor: AdminActor,
): Promise<ImageMutationResult> {
  assertCan(actor.role, "product:update");
  const result = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(productImages)
      .where(eq(productImages.id, imageId))
      .for("update");
    if (!before) throw new AdminInputError("Image not found");
    await tx.delete(productImages).where(eq(productImages.id, imageId));
    // Close the gap so positions stay 0..n-1.
    const rest = await tx
      .select({ id: productImages.id })
      .from(productImages)
      .where(
        and(eq(productImages.productId, before.productId), eq(productImages.kind, before.kind)),
      )
      .orderBy(asc(productImages.position));
    for (const [position, r] of rest.entries()) {
      await tx.update(productImages).set({ position }).where(eq(productImages.id, r.id));
    }
    const [stillUsed] = await tx
      .select({ id: productImages.id })
      .from(productImages)
      .where(eq(productImages.path, before.path))
      .limit(1);
    await writeAudit(tx, {
      actorId: actor.id,
      action: "product.image.delete",
      entity: "product",
      entityId: before.productId,
      diff: { kind: before.kind, path: before.path },
      ip: actor.ip,
    });
    return {
      before,
      orphan: !stillUsed && !before.path.startsWith("/") && !/^https?:\/\//i.test(before.path),
      invalidation: await invalidationFor(tx, before.productId, []),
    };
  });
  if (result.orphan) {
    const slash = result.before.path.indexOf("/");
    const bucket = result.before.path.slice(0, slash);
    const objectPath = result.before.path.slice(slash + 1);
    if (bucket === "products" || bucket === "cutouts") {
      await deleteStorageObjects(bucket, [objectPath]).catch(() => undefined);
    }
  }
  return { warnings: [], invalidation: result.invalidation };
}
