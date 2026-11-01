"use client";

import Link from "next/link";
import { useTransition, type MouseEvent } from "react";

import { addItem, getCartState, setCartOpen } from "@/components/store/cart/cart-store";
import { useToast } from "@/components/ui/Toast";
import { flyToTarget } from "@/features/motion/fly";
import { COPY } from "@/features/vibe/copy";
import { useVibe } from "@/features/vibe/useVibe";
import { track } from "@/lib/analytics/client";
import { addedQuantity } from "@/lib/analytics/cart-events";
import { cn } from "@/lib/cn";

export interface QuickAddProps {
  productId: string;
  productName: string;
  slug: string;
  /** The product's only active variant, when it is in stock (`ProductCard.quickAddVariantId`). */
  variantId: string | null;
  soldOut: boolean;
}

/** Soft, never outlined: a tint of the accent at rest, the full accent on hover / keyboard focus. */
const buttonClass = cn(
  "relative z-10 inline-flex min-h-11 w-full items-center justify-center rounded-full px-4 py-2 text-xs font-bold",
  // Text: the link colour with a quarter ink, so the tint holds >= 4.5:1 in all four themes (Mochi is the tight one).
  "bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface))] text-[color-mix(in_srgb,var(--ink)_25%,var(--link))]",
  "transition-colors ease-vibe hover:bg-accent hover:text-on-accent",
  "focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted disabled:hover:bg-surface-2 disabled:hover:text-ink-muted",
);

/**
 * The card's quick action, under the text. One in-stock variant: adds it (the card photo flies to the bag
 * straight away, the request and the toast follow, like the product page). Several variants: a link to the
 * product page to choose. Sold out: a disabled button. It sits above the card's stretched link (`z-10`).
 * A small client component so `ProductCardView` can still render inside the wishlist and other client trees.
 * Only the add button needs the toast and vibe providers, so the other two states render without them.
 */
export function QuickAdd({ productId, productName, slug, variantId, soldOut }: QuickAddProps) {
  if (soldOut) {
    return (
      <button type="button" disabled className={buttonClass}>
        Sold out
      </button>
    );
  }

  if (!variantId) {
    return (
      <Link href={`/products/${slug}`} className={buttonClass}>
        Choose options
        <span className="sr-only">: {productName}</span>
      </Link>
    );
  }

  return <AddButton productId={productId} productName={productName} variantId={variantId} />;
}

function AddButton({
  productId,
  productName,
  variantId,
}: {
  productId: string;
  productName: string;
  variantId: string;
}) {
  const { toast } = useToast();
  const { vibe } = useVibe();
  const [pending, startTransition] = useTransition();

  const onAdd = (event: MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    const photo = button.closest<HTMLElement>("[data-testid='product-card']")?.querySelector("img") ?? null;
    // Optimistic, like the product page: the photo flies now; the request and toast follow.
    void flyToTarget(photo ?? button, "cart", photo ? { src: photo.currentSrc || photo.src } : { emoji: "\u{1F6CD}️" });
    startTransition(async () => {
      const known = getCartState().cart;
      const before = known ? (known.lines.find((l) => l.variantId === variantId)?.qty ?? 0) : null;
      const result = await addItem(variantId, 1);
      if (!result.ok) {
        toast({ title: "Could not add that", description: result.error.message, tone: "danger" });
        return;
      }
      const after = result.data.cart.lines.find((l) => l.variantId === variantId)?.qty ?? 0;
      const added = addedQuantity(before, after, 1);
      if (added > 0) track("add_to_cart", { productId, value: added });
      const notice = result.data.notices.find((n) => !n.variantId || n.variantId === variantId);
      toast({
        title: COPY[vibe]["toast.addedToCart"],
        description: notice?.message ?? productName,
        tone: "success",
        action: { label: "View bag", onClick: () => setCartOpen(true) },
      });
    });
  };

  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={pending}
      aria-label={`Add to bag: ${productName}`}
      data-testid="quick-add"
      className={buttonClass}
    >
      {pending ? "Adding..." : "Add to bag"}
    </button>
  );
}
