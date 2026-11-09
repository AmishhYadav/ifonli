"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { addItem, setCartOpen } from "@/components/store/cart/cart-store";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/money";

import { KIT_SLOTS, KIT_TYPE_SLUG, clearKit, getKit, getServerKit, removeFromKit, subscribeKit } from "./kit-store";

/**
 * "Your DIY set": five blocks pinned to the bottom of the screen. Always there on the DIY collection page (empty
 * blocks numbered 1-5); on any other page it shows once something is picked, so it stays put while the shopper
 * scrolls or opens a product. Each pick fills the next free block; "Add to cart" (once all five are picked) puts them in the bag.
 */
export function KitTray() {
  const kit = useSyncExternalStore(subscribeKit, getKit, getServerKit);
  const pathname = usePathname();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);

  const onDiyPage = pathname === `/types/${KIT_TYPE_SLUG}`;
  if (kit.length === 0 && !onDiyPage) return null;

  const complete = kit.length === KIT_SLOTS;
  const total = kit.reduce((sum, i) => sum + i.pricePaise, 0);

  const addAll = async () => {
    setAdding(true);
    let failed = 0;
    for (const item of kit) {
      const result = await addItem(item.variantId, 1);
      if (result.ok) removeFromKit(item.productId);
      else failed += 1;
    }
    setAdding(false);
    if (failed > 0) {
      toast({ title: "Some items could not be added", description: "They are still in your set. Please try again.", tone: "danger" });
      return;
    }
    clearKit();
    toast({
      title: "Set added to your bag",
      tone: "success",
      action: { label: "View bag", onClick: () => setCartOpen(true) },
    });
  };

  return (
    <>
      {/* Keeps the footer from hiding behind the fixed tray. */}
      <div aria-hidden="true" className="h-36 sm:h-28" />
      <section
        aria-label="Your DIY set"
        data-testid="kit-tray"
        className="fixed inset-x-0 bottom-0 z-40 bg-surface/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.2)] backdrop-blur sm:py-4"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-x-4 gap-y-2 max-sm:grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_1fr]">
          <p className="text-base font-bold sm:text-center">Your DIY set</p>
          <ol className="flex gap-2 max-sm:order-last max-sm:col-span-2 sm:gap-3">
            {Array.from({ length: KIT_SLOTS }, (_, i) => {
              const item = kit[i];
              return (
                <li
                  key={item?.productId ?? `empty-${i}`}
                  data-testid="kit-slot"
                  data-filled={item ? "" : undefined}
                  className={cn(
                    "relative aspect-square min-w-0 flex-1 overflow-hidden rounded-card sm:size-16 sm:flex-none",
                    item ? "bg-bg shadow-card" : "border-2 border-dashed border-accent/50 bg-accent/10",
                  )}
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
                        aria-label={`Remove from set: ${item.name}`}
                        className="absolute top-0.5 right-0.5 grid size-6 place-items-center rounded-full bg-ink text-xs font-bold text-bg focus-visible:outline-3 focus-visible:outline-focus-ring"
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <span className="grid size-full place-items-center text-sm text-ink-muted">{i + 1}</span>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex items-center gap-2 justify-self-end">
            {complete ? (
              <>
                <span
                  data-testid="kit-total"
                  className="inline-flex min-h-11 items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface))] px-5 py-2 text-sm font-bold tabular-nums"
                >
                  {formatINR(total)}
                </span>
                <button
                  type="button"
                  onClick={addAll}
                  disabled={adding}
                  data-testid="kit-add-to-cart"
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-on-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-50"
                >
                  {adding ? "Adding..." : "Add to cart"}
                </button>
              </>
            ) : (
              <span className="text-sm font-semibold text-ink-muted tabular-nums">
                {kit.length}/{KIT_SLOTS} picked
              </span>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
