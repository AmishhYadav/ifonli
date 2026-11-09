"use client";

import { Icon } from "@/components/ui/Icon";
import { flyToTarget } from "@/features/motion/fly";
import { track } from "@/lib/analytics/client";
import { cn } from "@/lib/cn";

import { toggleWishlist } from "./store";
import { useIsWishlisted } from "./useWishlist";

export interface WishlistHeartProps {
  productId: string;
  /** Only used to give the button a specific name for assistive tech ("Save Heart charm to wishlist"). */
  productName?: string;
  /** `card` floats over a product image; `inline` sits in the PDP next to the title. */
  appearance?: "card" | "inline";
  className?: string;
}

/**
 * Wishlist toggle. `aria-pressed` carries the state; the label is "Save to wishlist" / "Remove from
 * wishlist" (plus the product name when known). 44px target. The saved state comes from this device's
 * `localStorage`, so the server always renders the unsaved heart and the client corrects it on hydration.
 */
export function WishlistHeart({ productId, productName, appearance = "card", className }: WishlistHeartProps) {
  const saved = useIsWishlisted(productId);
  const label = saved ? "Remove from wishlist" : "Save to wishlist";
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={productName ? `${label}: ${productName}` : label}
      data-testid="wishlist-heart"
      onClick={(event) => {
        if (!toggleWishlist(productId)) return;
        track("wishlist_add", { productId });
        // Adding (not removing): the nearest product photo (card or gallery) flies to the header heart.
        const scope = event.currentTarget.closest("[data-product-id], [data-testid='product-card']");
        const photo =
          scope?.querySelector<HTMLImageElement>("img") ??
          document.querySelector<HTMLImageElement>("[data-fly-source] img");
        if (photo) void flyToTarget(photo, "wishlist", { src: photo.currentSrc || photo.src });
        else void flyToTarget(event.currentTarget, "wishlist", { emoji: "\u2764\uFE0F" });
      }}
      className={cn(
        "group/heart inline-flex size-11 items-center justify-center rounded-full text-ink transition-transform ease-vibe",
        "active:scale-95",
        className,
      )}
    >
      <span
        className={cn(
          "grid place-items-center rounded-full transition-[transform,background-color] ease-vibe group-hover/heart:scale-105",
          appearance === "card"
            ? "size-9 bg-surface/90 group-hover/heart:bg-surface"
            : "size-11 bg-surface-2 group-hover/heart:bg-surface",
        )}
      >
        <Icon name={saved ? "heart-filled" : "heart"} className={cn("size-5", saved && "text-sale")} />
      </span>
    </button>
  );
}
