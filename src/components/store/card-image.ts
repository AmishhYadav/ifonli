import type { ImageRef, ProductCard } from "@/server/services/queries/types";

/**
 * The picture a product card tile shows: the product's first photo (the themed-background shot) fills the tile.
 * A transparent cutout, floating on the product's vibe gradient (`art-<vibe>`), is only the fallback.
 */
export function cardImageRef(product: Pick<ProductCard, "image" | "cutout">): {
  ref: ImageRef | null;
  isCutout: boolean;
} {
  if (product.image && product.image.path !== product.cutout?.path)
    return { ref: product.image, isCutout: false };
  if (product.cutout) return { ref: product.cutout, isCutout: true };
  return { ref: product.image, isCutout: false };
}
