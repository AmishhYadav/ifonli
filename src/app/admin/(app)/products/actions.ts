"use server";

import { z } from "zod";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { requireAdmin } from "@/server/auth/session";
import { revalidateCatalog, revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import {
  deleteImage,
  prepareImageUpload,
  registerUploadedImage,
  reorderImages,
  updateImageAlt,
  type PreparedUpload,
} from "@/server/services/admin/product-images";
import {
  createProduct,
  duplicateProduct,
  isSlugAvailable,
  setProductStatus,
  updateProduct,
  type ProductMutationResult,
} from "@/server/services/admin/products";
import { resolveImageUrl } from "@/server/services/media";
import {
  PRODUCT_STATUSES,
  imageKindSchema,
  slugSchema,
} from "@/server/services/admin/product-schema";

function publish(result: ProductMutationResult): { id: string; slug: string } {
  revalidateCatalog(result.invalidation);
  if (result.stockChanged) revalidateStock({ productIds: [result.id] });
  return { id: result.id, slug: result.slug };
}

const idSchema = z.uuid();

export async function createProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string; slug: string }>> {
  return runAdminAction("product:create", async ({ actor }) =>
    publish(await createProduct(getDb(), input, actor)),
  );
}

export async function updateProductAction(
  productId: string,
  input: unknown,
): Promise<ActionResult<{ id: string; slug: string }>> {
  return runAdminAction("product:update", async ({ actor }) =>
    publish(await updateProduct(getDb(), idSchema.parse(productId), input, actor)),
  );
}

export async function duplicateProductAction(
  productId: string,
): Promise<ActionResult<{ id: string; slug: string }>> {
  return runAdminAction("product:create", async ({ actor }) =>
    publish(await duplicateProduct(getDb(), idSchema.parse(productId), actor)),
  );
}

export async function setProductStatusAction(
  productId: string,
  status: unknown,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const parsed = z.enum(PRODUCT_STATUSES).parse(status);
  return runAdminAction(
    parsed === "archived" ? "product:archive" : "product:update",
    async ({ actor }) =>
      publish(await setProductStatus(getDb(), idSchema.parse(productId), parsed, actor)),
  );
}

/** Live slug uniqueness check for the form (read-only; still needs a signed-in admin). */
export async function checkSlugAction(
  slug: string,
  excludeId?: string,
): Promise<{ available: boolean; valid: boolean }> {
  await requireAdmin("product:view", { denied: "throw" });
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return { available: false, valid: false };
  return { valid: true, available: await isSlugAvailable(getDb(), parsed.data, excludeId) };
}

// --- images -------------------------------------------------------------------------------------

export async function prepareImageUploadAction(input: {
  productId: string;
  kind: string;
  extension: string;
}): Promise<ActionResult<PreparedUpload>> {
  return runAdminAction("product:update", async ({ actor }) =>
    prepareImageUpload(
      getDb(),
      {
        productId: idSchema.parse(input.productId),
        kind: imageKindSchema.parse(input.kind),
        extension: z.string().max(8).parse(input.extension),
      },
      actor,
    ),
  );
}

export async function registerImageAction(input: {
  productId: string;
  kind: string;
  dbPath: string;
  alt: string;
}) {
  return runAdminAction("product:update", async ({ actor }) => {
    const res = await registerUploadedImage(
      getDb(),
      {
        productId: idSchema.parse(input.productId),
        kind: imageKindSchema.parse(input.kind),
        dbPath: z.string().max(300).parse(input.dbPath),
        alt: input.alt,
      },
      actor,
    );
    revalidateCatalog(res.invalidation);
    return { image: res.image!, url: resolveImageUrl(res.image!.path), warnings: res.warnings };
  });
}

export async function updateImageAltAction(imageId: string, alt: string): Promise<ActionResult> {
  return runAdminAction("product:update", async ({ actor }) => {
    const res = await updateImageAlt(getDb(), idSchema.parse(imageId), alt, actor);
    revalidateCatalog(res.invalidation);
    return undefined;
  });
}

export async function reorderImagesAction(
  productId: string,
  kind: string,
  orderedIds: string[],
): Promise<ActionResult> {
  return runAdminAction("product:update", async ({ actor }) => {
    const res = await reorderImages(
      getDb(),
      idSchema.parse(productId),
      imageKindSchema.parse(kind),
      z.array(z.uuid()).max(100).parse(orderedIds),
      actor,
    );
    revalidateCatalog(res.invalidation);
    return undefined;
  });
}

export async function deleteImageAction(imageId: string): Promise<ActionResult> {
  return runAdminAction("product:update", async ({ actor }) => {
    const res = await deleteImage(getDb(), idSchema.parse(imageId), actor);
    revalidateCatalog(res.invalidation);
    return undefined;
  });
}
