import "server-only";

import { imageProps } from "@/server/services/media";
import type { ProductDetail } from "@/server/services/queries/types";

import type { PdpImage, PdpModel } from "./product-model";

/** The serialisable slice of a product the client components need. */
export function buildPdpModel(product: ProductDetail): PdpModel {
  return {
    productId: product.id,
    name: product.name,
    options: [...product.options]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({
        id: o.id,
        name: o.name,
        values: [...o.values]
          .sort((a, b) => a.position - b.position)
          .map((v) => ({ id: v.id, value: v.value, swatchHex: v.swatchHex })),
      })),
    variants: product.variants
      .filter((v) => v.active)
      .map((v) => ({
        id: v.id,
        title: v.title,
        optionValueIds: v.optionValueIds,
        pricePaise: v.pricePaise,
        mrpPaise: v.mrpPaise,
      })),
  };
}

/**
 * Gallery images: photos first, then cutouts, one entry per file (the seed stores the same artwork as both
 * a photo and a cutout). An image that is also a cutout, or is a cutout itself, is shown contained on a tile.
 * Paths that cannot be resolved are skipped instead of failing the page.
 */
export function buildPdpImages(product: ProductDetail): PdpImage[] {
  const cutoutPaths = new Set(product.images.filter((i) => i.kind === "cutout").map((i) => i.path));
  const seen = new Set<string>();
  const images: PdpImage[] = [];
  for (const image of product.images) {
    if (seen.has(image.path)) continue;
    seen.add(image.path);
    try {
      const props = imageProps({
        path: image.path,
        alt: image.alt || product.name,
        width: image.width,
        height: image.height,
      });
      images.push({
        id: image.id,
        variantId: image.variantId,
        src: props.src,
        alt: props.alt,
        width: props.width,
        height: props.height,
        isCutout: image.kind === "cutout" || cutoutPaths.has(image.path),
      });
    } catch (error) {
      console.error(`PDP: unusable image for "${product.slug}"`, error);
    }
  }
  return images;
}
