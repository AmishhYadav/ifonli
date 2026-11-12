"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { addPack, setCartOpen } from "@/components/store/cart/cart-store";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { DIY_CHAIN_IMAGE } from "@/lib/diy";
import { formatINR } from "@/lib/money";

import { KIT_CHARMS, KIT_SLOTS, KIT_TYPE_SLUG, clearKit, getKit, getServerKit, removeFromKit, subscribeKit } from "./kit-store";

const BOX = "relative aspect-square min-w-0 flex-1 overflow-hidden rounded-card sm:size-16 sm:flex-none";

/**
 * "Your DIY pack": five boxes pinned to the bottom of the screen. Box 1 is always the free chain; boxes 2 to 5 take
 * the charms the shopper picks, in order. Always there on the DIY page; on any other page it shows once something is
 * picked, so it stays put while the shopper scrolls or opens a product. "Add to bag" works from the first charm: the
 * pack costs the sum of its charms (the chain is ₹0).
 */
export function KitTray() {
  const kit = useSyncExternalStore(subscribeKit, getKit, getServerKit);
  const pathname = usePathname();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);

  const onDiyPage = pathname === `/types/${KIT_TYPE_SLUG}`;
  if (kit.length === 0 && !onDiyPage) return null;

  const total = kit.reduce((sum, i) => sum + i.pricePaise, 0);

  const addToBag = async () => {
    if (adding || kit.length === 0) return;
    setAdding(true);
    try {
      const result = await addPack(kit.map((i) => i.variantId));
      if (!result.ok) {
        toast({ title: "Your pack was not added", description: result.error.message, tone: "danger" });
        return;
      }
      clearKit();
      toast({
        title: "Pack added to your bag",
        description: "Your free chain is included.",
        tone: "success",
        action: { label: "View bag", onClick: () => setCartOpen(true) },
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      {/* Keeps the footer from hiding behind the fixed tray. */}
      <div aria-hidden="true" className="h-44 sm:h-28" />
      <section
        aria-label="Your DIY pack"
        data-testid="kit-tray"
        className="fixed inset-x-0 bottom-0 z-40 bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.2)] backdrop-blur sm:pt-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-x-4 gap-y-2 sm:grid-cols-[1fr_auto_1fr]">
          {/* Phone: title and status share a row above the boxes. From `sm`: a stacked block at the left. */}
          <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
            <p className="text-base font-bold whitespace-nowrap">Your DIY pack</p>
            <p className="text-right text-xs text-ink-muted sm:text-left" data-testid="kit-status" aria-live="polite">
              {kit.length === 0
                ? `Free chain, pick 1 to ${KIT_CHARMS} charms`
                : `Free chain + ${kit.length} of ${KIT_CHARMS} ${kit.length === 1 ? "charm" : "charms"}`}
            </p>
          </div>
          <ol className="flex gap-2 sm:gap-3">
            <li data-testid="kit-chain" data-filled="" className={cn(BOX, "bg-bg shadow-card")}>
              <Image src={DIY_CHAIN_IMAGE} alt="" fill sizes="64px" className="object-contain p-1 pb-3" />
              <span className="absolute inset-x-0 bottom-0 bg-surface/90 py-px text-center text-[10px] leading-tight font-semibold text-ink">
                Included
              </span>
              <span className="sr-only">Chain, included free</span>
            </li>
            {Array.from({ length: KIT_SLOTS - 1 }, (_, i) => {
              const item = kit[i];
              return (
                <li
                  key={item?.productId ?? `empty-${i}`}
                  data-testid="kit-slot"
                  data-filled={item ? "" : undefined}
                  className={cn(BOX, item ? "bg-bg shadow-card" : "border-2 border-dashed border-accent/50 bg-accent/10")}
                >
                  {item ? (
                    <>
                      {item.imageSrc ? (
                        <Image src={item.imageSrc} alt={item.name} fill sizes="64px" className="object-contain p-1" />
                      ) : (
                        <span className="grid size-full place-items-center p-1 text-center text-[10px] leading-tight">{item.name}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFromKit(item.productId)}
                        aria-label={`Remove from kit: ${item.name}`}
                        className="absolute top-0 right-0 flex size-11 touch-manipulation items-start justify-end p-1 focus-visible:outline-3 focus-visible:outline-focus-ring"
                      >
                        <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-ink text-xs font-bold text-bg">
                          ×
                        </span>
                      </button>
                    </>
                  ) : (
                    <span className="grid size-full place-items-center text-sm text-ink-muted">{i + 2}</span>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-between gap-3 sm:justify-end sm:justify-self-end">
            {kit.length > 0 ? (
              <span
                data-testid="kit-total"
                className="inline-flex min-h-11 items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface))] px-4 py-2 text-base font-bold tabular-nums max-sm:bg-transparent max-sm:px-0"
              >
                <span className="sr-only">Pack total </span>
                {formatINR(total)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={addToBag}
              disabled={adding || kit.length === 0}
              data-testid="kit-add-to-cart"
              className="ml-auto inline-flex min-h-11 touch-manipulation items-center justify-center rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-on-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-50"
            >
              {adding ? "Adding..." : "Add to bag"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
