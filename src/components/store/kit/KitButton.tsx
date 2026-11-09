"use client";

import { useSyncExternalStore } from "react";

import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

import { KIT_SLOTS, addToKit, getKit, getServerKit, removeFromKit, subscribeKit } from "./kit-store";

export interface KitButtonProps {
  productId: string;
  productName: string;
  slug: string;
  variantId: string;
  imageSrc: string | null;
  pricePaise: number;
}

/** The card's action for DIY products (instead of Add to bag): puts the product in the next free slot of the kit tray (or takes it out). */
export function KitButton({ productId, productName, slug, variantId, imageSrc, pricePaise }: KitButtonProps) {
  const kit = useSyncExternalStore(subscribeKit, getKit, getServerKit);
  const { toast } = useToast();
  const picked = kit.some((i) => i.productId === productId);
  const full = kit.length >= KIT_SLOTS;

  const onClick = () => {
    if (picked) {
      removeFromKit(productId);
      return;
    }
    if (!addToKit({ productId, variantId, name: productName, slug, imageSrc, pricePaise })) {
      toast({ title: "Your collection is full", description: `A collection holds ${KIT_SLOTS} items. Remove one to swap.`, tone: "danger" });
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={picked}
      aria-disabled={!picked && full ? true : undefined}
      aria-label={`${picked ? "Remove from" : "Add to"} collection: ${productName}`}
      data-testid="kit-add"
      className={cn(
        "relative z-10 inline-flex min-h-11 w-full items-center justify-center rounded-full px-4 py-2 text-xs font-bold transition-colors ease-vibe",
        "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        picked
          ? "bg-accent text-on-accent"
          : "bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface))] text-[color-mix(in_srgb,var(--ink)_25%,var(--link))] hover:bg-accent hover:text-on-accent",
        !picked && full && "opacity-60",
      )}
    >
      {picked ? "In your collection" : "Add to collection"}
    </button>
  );
}
