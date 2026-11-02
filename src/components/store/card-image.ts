import type { ImageRef, ProductCard } from "@/server/services/queries/types";

/**
 * The picture a product card tile shows. A transparent cutout floats on the product's vibe gradient (`art-<vibe>`),
 * which reads the same in every theme, so it wins when the product has one; otherwise the main photo fills the tile.
 */
export function cardImageRef(product: Pick<ProductCard, "image" | "cutout">): {
  ref: ImageRef | null;
  isCutout: boolean;
} {
  if (product.cutout) return { ref: product.cutout, isCutout: true };
  return { ref: product.image, isCutout: false };
}
