"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { FreeThreadLine } from "@/components/orders/FreeThreadLine";
import { buttonVariants } from "@/components/ui/buttonStyles";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import type { CartView } from "@/features/cart/types";
import { VIBES, VIBE_NAMES } from "@/features/vibe/config";
import { cn } from "@/lib/cn";

import { hydrateCart } from "./cart-store";
import { CartLines } from "./CartLines";
import { CartNotices } from "./CartNotices";
import { CartTotals } from "./CartTotals";
import { ReturnNote } from "./ReturnNote";
import { useCartStore, useOptimisticCart } from "./useCart";

interface CartPageViewProps {
  /** The cart as the server rendered it (re-validated against live stock). */
  initial: CartView;
  returnPolicyText: string;
  emptyTitle: ReactNode;
  emptyBody: ReactNode;
}

/**
 * The /cart page body. Same lines and maths as the drawer (they share the store). Buy scope: palette only, plain and clear.
 */
export function CartPageView({ initial, returnPolicyText, emptyTitle, emptyBody }: CartPageViewProps) {
  const { cart: stored, notices, error, announcement } = useCartStore();
  // The server render is the baseline; the store wins once it holds the same or a newer version.
  const base = stored && stored.version >= initial.version ? stored : initial;
  const { cart, pending, setQuantity, remove } = useOptimisticCart(base);

  useEffect(() => {
    hydrateCart(initial);
  }, [initial]);

  const shownNotices = stored ? notices : initial.notices;

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <CartNotices notices={shownNotices} error={error} />
        <EmptyState icon="bag" headingLevel="h2" title={emptyTitle} className="py-14">
          {emptyBody}
        </EmptyState>
        <nav aria-label="Browse by vibe">
          <ul className="flex flex-wrap justify-center gap-2">
            {VIBES.map((vibe) => (
              <li key={vibe}>
                <Link
                  href={`/vibes/${vibe}`}
                  data-vibe={vibe}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-button bg-accent px-4 text-base font-display text-on-accent",
                    "transition-transform ease-vibe hover:-translate-y-0.5",
                  )}
                >
                  {VIBE_NAMES[vibe]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-center">
          <Link href="/shop" className={buttonVariants({ size: "lg" })}>
            Shop everything
          </Link>
        </p>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-12">
      <section aria-labelledby="cart-items-heading" className="flex flex-col gap-5">
        <h2 id="cart-items-heading" className="sr-only">
          Items
        </h2>
        <CartNotices notices={shownNotices} error={error} />
        <CartLines cart={cart} layout="page" onQuantity={setQuantity} onRemove={remove} />
        <FreeThreadLine className="border-t border-hairline pt-5" />
        <Link
          href="/shop"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-base font-semibold text-link underline underline-offset-4 hover:no-underline"
        >
          <Icon name="arrow-left" className="size-4" />
          Continue shopping
        </Link>
      </section>

      <aside
        aria-labelledby="cart-summary-heading"
        className="flex flex-col gap-5 rounded-card bg-surface p-5 shadow-card sm:p-6 lg:sticky lg:top-6"
      >
        <h2 id="cart-summary-heading" className="text-xl font-bold">
          Order summary
        </h2>
        <div aria-busy={pending} className={pending ? "opacity-70 transition-opacity" : "transition-opacity"}>
          <CartTotals cart={cart} />
        </div>
        <ReturnNote text={returnPolicyText} />
        <Link
          href="/checkout"
          data-testid="cart-checkout"
          className={buttonVariants({ size: "lg", fullWidth: true })}
        >
          Checkout
        </Link>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </aside>
    </div>
  );
}
