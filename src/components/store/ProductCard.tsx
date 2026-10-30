import type { ReactNode } from "react";

import { imageProps } from "@/server/services/media";
import type { ProductCard as ProductCardData } from "@/server/services/queries/types";

import { DEFAULT_CARD_SIZES, ProductCardView, type ResolvedImage } from "./ProductCardView";

export interface ProductCardProps {
  product: ProductCardData;
  sizes?: string;
  eager?: boolean;
  /** Wishlist heart (a client component) rendered top-right; the wishlist feature plugs in here later. */
  wishlist?: ReactNode;
  className?: string;
}

/**
 * Server component. `src/server/services/media.ts` is `server-only` (it resolves Supabase storage paths),
 * so image URLs are resolved here and the rest is delegated to the presentational `ProductCardView`.
 * To render cards from a client component, resolve images on the server and use `ProductCardView` directly.
 * A path that cannot be resolved degrades to the placeholder tile instead of failing the whole page.
 */
export function ProductCard({ product, sizes = DEFAULT_CARD_SIZES, ...rest }: ProductCardProps) {
  let image: ResolvedImage | null = null;
  if (product.image) {
    try {
      image = imageProps(product.image);
    } catch (error) {
      console.error(`ProductCard: unusable image for "${product.slug}"`, error);
    }
  }
  const isCutout = Boolean(product.image && product.cutout && product.image.path === product.cutout.path);
  return <ProductCardView product={product} image={image} isCutout={isCutout} sizes={sizes} {...rest} />;
}
