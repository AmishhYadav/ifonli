import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge, Icon, Price, Skeleton, VibeDot } from "@/components/ui";
import { VIBE_NAMES, isVibe } from "@/features/vibe/config";
import { cn } from "@/lib/cn";
import type { ProductCard as ProductCardData } from "@/server/services/queries/types";

/** An image ready for `next/image` (the shape `imageProps()` returns). */
export interface ResolvedImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export const DEFAULT_CARD_SIZES = "(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw";

export interface ProductCardViewProps {
  product: ProductCardData;
  /** Main image, already resolved to a URL (see `ProductCard`). `null` shows a neutral placeholder. */
  image: ResolvedImage | null;
  /** True when `image` is a cutout (transparent PNG-style art): shown contained on a tinted tile. */
  isCutout: boolean;
  /** `sizes` for `next/image`; must match the grid the card sits in. */
  sizes?: string;
  /** Load eagerly (first row above the fold) instead of lazily. */
  eager?: boolean;
  /** Slot in the top-right corner for the wishlist heart (a button, 44px target). */
  wishlist?: ReactNode;
  className?: string;
}

/**
 * Presentational product card (no server imports, so it can also render inside client components).
 * The whole card is one link to `/products/{slug}` through a stretched link on the name; the wishlist slot sits above it.
 */
export function ProductCardView({
  product,
  image,
  isCutout,
  sizes = DEFAULT_CARD_SIZES,
  eager = false,
  wishlist,
  className,
}: ProductCardViewProps) {
  const { name, typeName, slug, inStock, lowStock, hasPriceRange, primaryVibe } = product;
  const vibeName = primaryVibe && isVibe(primaryVibe) ? VIBE_NAMES[primaryVibe] : null;
  const soldOut = !inStock;

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-card border-token bg-surface text-ink shadow-card",
        "transition-[transform,box-shadow] ease-vibe hover:-translate-y-1",
        "has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus-ring",
        className,
      )}
      data-testid="product-card"
      data-product-id={product.id}
      data-sold-out={soldOut || undefined}
    >
      <div
        className={cn(
          "relative aspect-square w-full overflow-hidden border-b border-border",
          isCutout || !image ? "bg-surface-2" : "bg-surface",
        )}
      >
        {image ? (
          <Image
            src={image.src}
            // Decorative: the product name link right below carries the meaning.
            alt=""
            fill
            sizes={sizes}
            loading={eager ? "eager" : "lazy"}
            className={cn(
              "transition-transform ease-vibe group-hover:scale-[1.04]",
              isCutout ? "object-contain p-[12%]" : "object-cover",
              soldOut && "opacity-60 grayscale",
            )}
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-ink-muted">
            <Icon name="image" className="size-10" />
          </span>
        )}

        <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-4rem)] flex-wrap gap-1.5">
          {vibeName && primaryVibe ? (
            <span className="inline-flex items-center gap-1.5 rounded-button bg-surface px-2 py-0.5 text-xs font-semibold text-ink border-token">
              <VibeDot vibe={primaryVibe} />
              {vibeName}
            </span>
          ) : null}
        </div>

        {wishlist ? <div className="absolute top-1 right-1 z-10">{wishlist}</div> : null}

        {soldOut || lowStock ? (
          <div className="pointer-events-none absolute bottom-2 left-2">
            {soldOut ? (
              <Badge tone="neutral" className="border-token bg-surface">
                Sold out
              </Badge>
            ) : (
              <Badge tone="warning">Low stock</Badge>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{typeName}</p>
        <h3 className="font-display text-lg leading-tight">
          <Link
            href={`/products/${slug}`}
            className="outline-none after:absolute after:inset-0 after:content-['']"
          >
            {name}
            {soldOut ? <span className="sr-only"> (sold out)</span> : null}
            {!soldOut && lowStock ? <span className="sr-only"> (low stock)</span> : null}
          </Link>
        </h3>
        <Price
          className="mt-auto pt-2"
          pricePaise={product.priceFromPaise}
          mrpPaise={product.mrpFromPaise}
          from={hasPriceRange}
        />
      </div>
    </article>
  );
}

/** Loading placeholder with the same box as `ProductCard` (no layout shift). */
export function ProductCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-card border-token bg-surface shadow-card",
        className,
      )}
    >
      <Skeleton shape="block" className="aspect-square w-full rounded-none" />
      <div className="flex flex-col gap-2 p-3 sm:p-4">
        <Skeleton shape="text" className="h-3 w-1/3" />
        <Skeleton shape="text" className="h-5 w-4/5" />
        <Skeleton shape="text" className="mt-2 h-5 w-1/2" />
      </div>
    </div>
  );
}
