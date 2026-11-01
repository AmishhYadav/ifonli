"use client";

import Link from "next/link";
import { useEffect, useRef, type MouseEvent } from "react";

import { Icon } from "@/components/ui/Icon";
import { buttonVariants } from "@/components/ui/buttonStyles";
import { cn } from "@/lib/cn";

import { seedCartCount, setCartOpen } from "./cart-store";
import { preloadCartDrawer } from "./CartDrawer";
import { useCartStore } from "./useCart";

/**
 * The header's cart entry. A real link to `/cart` (works without JavaScript and for middle-click); a plain
 * click opens the cart drawer instead. The badge shows the live item count: the server-rendered value
 * first (`initialCount`), then whatever the client store knows after any cart change. `initialCount={null}`
 * is the Suspense fallback ("not known yet"): it shows no badge and does not seed the store, so the real
 * count can still seed it once the cart cookie has been read.
 */
export function CartTrigger({ initialCount, className }: { initialCount: number | null; className?: string }) {
  const { count } = useCartStore();
  const shown = count ?? initialCount ?? 0;
  const badge = useRef<HTMLSpanElement>(null);
  const previous = useRef(shown);

  // A soft pop when the count goes up (not on first render, not when it goes down).
  useEffect(() => {
    const el = badge.current;
    if (el && shown > previous.current) {
      el.classList.remove("badge-pop");
      void el.offsetWidth; // restart the animation if it is already running
      el.classList.add("badge-pop");
    }
    previous.current = shown;
  }, [shown]);

  useEffect(() => {
    if (initialCount !== null) seedCartCount(initialCount);
  }, [initialCount]);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    setCartOpen(true);
  };

  return (
    <Link
      href="/cart"
      onClick={onClick}
      onPointerEnter={() => void preloadCartDrawer()}
      onFocus={() => void preloadCartDrawer()}
      onTouchStart={() => void preloadCartDrawer()}
      aria-label={shown > 0 ? `Bag, ${shown} ${shown === 1 ? "item" : "items"}` : "Bag"}
      aria-haspopup="dialog"
      data-testid="cart-button"
      data-fly-target="cart"
      className={cn(buttonVariants({ variant: "ghost", size: "md" }), "relative min-w-12 p-0", className)}
    >
      <Icon name="bag" className="size-6" />
      {shown > 0 ? (
        <span
          ref={badge}
          aria-hidden="true"
          data-testid="cart-count"
          className="absolute top-1 right-0.5 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-xs leading-5 font-bold text-on-accent tabular-nums"
        >
          {shown > 99 ? "99+" : shown}
        </span>
      ) : null}
    </Link>
  );
}
