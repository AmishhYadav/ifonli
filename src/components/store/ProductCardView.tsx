import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import { VIBE_NAMES, isVibe, type Vibe } from "@/features/vibe/config";
import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/money";
import type { ProductCard as ProductCardData } from "@/server/services/queries/types";

import { QuickAdd } from "./QuickAdd";

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

/** Literal class names so Tailwind finds them: the tile wears its PRODUCT's vibe gradient, whatever the site theme. */
const ART_CLASS: Record<Vibe, string> = {
  cute: "art-cute",
  funky: "art-funky",
  bold: "art-bold",
  gothic: "art-gothic",
};

/** Whole-number percent off (rounded), or 0 when the MRP is not above the price. */
function percentOff(pricePaise: number, mrpPaise: number): number {
  if (mrpPaise <= pricePaise || mrpPaise <= 0) return 0;
  return Math.round((1 - pricePaise / mrpPaise) * 100);
}

/**
 * Presentational product card (no server imports, so it can also render inside client components).
 * No box: a rounded image tile on the vibe's art gradient, then the text on the page background. The whole
 * card is one link to `/products/{slug}` through a stretched link on the name; the wishlist heart and the
 * quick "Add to bag" sit above it.
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
  const { name, slug, inStock, lowStock, hasPriceRange, primaryVibe } = product;
  const vibeName = primaryVibe && isVibe(primaryVibe) ? VIBE_NAMES[primaryVibe] : null;
  const soldOut = !inStock;
  const off = percentOff(product.priceFromPaise, product.mrpFromPaise);

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col rounded-card text-ink",
        // Keyboard focus on the card's link rings the whole card (image, text and button), softly offset.
        "has-[h3_a:focus-visible]:outline-3 has-[h3_a:focus-visible]:outline-offset-4 has-[h3_a:focus-visible]:outline-focus-ring",
        className,
      )}
      data-testid="product-card"
      data-product-id={product.id}
      data-sold-out={soldOut || undefined}
    >
      <div
        className={cn(
          "relative aspect-[4/5] w-full overflow-hidden rounded-card shadow-card",
          "transition-[box-shadow,transform] ease-vibe group-hover:-translate-y-0.5",
          "group-hover:shadow-[var(--shadow-card),0_16px_32px_-14px_color-mix(in_srgb,var(--accent)_45%,transparent)]",
          primaryVibe && isVibe(primaryVibe) ? ART_CLASS[primaryVibe] : "art-none",
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

        <div className="pointer-events-none absolute top-3 left-3 flex max-w-[calc(100%-3.75rem)] flex-wrap gap-1.5">
          {vibeName && primaryVibe ? (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface/80 px-2 py-1 text-[11px] font-semibold text-ink backdrop-blur sm:px-2.5 sm:text-xs">
              <span aria-hidden="true" data-vibe={primaryVibe} className="size-2 flex-none rounded-full bg-accent max-sm:hidden" />
              <span className="truncate">{vibeName}</span>
            </span>
          ) : null}
        </div>

        {soldOut ? (
          <span className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-ink px-3 py-1 text-xs font-bold text-bg">
            Sold out
          </span>
        ) : lowStock ? (
          <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-surface/80 px-2.5 py-1 text-xs font-semibold text-ink backdrop-blur">
            Low stock
          </span>
        ) : null}
      </div>

      {/* Outside the tile: the tile gets a transform on hover, which would trap the heart under the stretched link. */}
      {wishlist ? <div className="absolute top-1.5 right-1.5 z-10">{wishlist}</div> : null}

      <div className="flex flex-1 flex-col gap-0.5 pt-3">
        <h3 className="truncate font-[family-name:var(--font-body)] text-sm font-bold tracking-normal text-ink">
          <Link
            href={`/products/${slug}`}
            className="outline-none after:absolute after:inset-0 after:content-['']"
          >
            {name}
            {soldOut ? <span className="sr-only"> (sold out)</span> : null}
            {!soldOut && lowStock ? <span className="sr-only"> (low stock)</span> : null}
          </Link>
        </h3>
        <p className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-1 text-sm">
          {hasPriceRange ? <span className="text-ink-muted">From</span> : null}
          <span className="font-bold tabular-nums text-price">{formatINR(product.priceFromPaise)}</span>
          {product.mrpFromPaise > product.priceFromPaise ? (
            <>
              <s className="text-xs tabular-nums text-ink-muted">
                <span className="sr-only">MRP </span>
                {formatINR(product.mrpFromPaise)}
              </s>
              {off > 0 ? <span className="text-xs font-semibold text-sale">({off}% OFF)</span> : null}
            </>
          ) : null}
        </p>
      </div>

      <div className="pt-3">
        <QuickAdd
          productId={product.id}
          productName={name}
          slug={slug}
          variantId={product.quickAddVariantId}
          soldOut={soldOut}
        />
      </div>
    </article>
  );
}

/** Loading placeholder with the same box as `ProductCard` (no layout shift). */
export function ProductCardSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex h-full flex-col", className)}>
      <Skeleton shape="block" className="aspect-[4/5] w-full rounded-card" />
      <div className="flex flex-col gap-2 pt-3">
        <Skeleton shape="text" className="h-4 w-1/3" />
        <Skeleton shape="text" className="h-4 w-4/5" />
        <Skeleton shape="text" className="h-4 w-1/2" />
      </div>
      <Skeleton shape="block" className="mt-3 h-11 w-full rounded-full" />
    </div>
  );
}
