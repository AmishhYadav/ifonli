"use client";

import Link from "next/link";
import { useEffect, type MouseEvent } from "react";

import { Icon, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/cn";

import { seedCartCount, setCartOpen } from "./cart-store";
import { useCartStore } from "./useCart";

/**
 * The header's cart entry. A real link to `/cart` (works without JavaScript and for middle-click); a plain
 * click opens the cart drawer instead. The badge shows the live item count: the server-rendered value
 * first (`initialCount`), then whatever the client store knows after any cart change.
 */
export function CartTrigger({ initialCount, className }: { initialCount: number; className?: string }) {
  const { count } = useCartStore();
  const shown = count ?? initialCount;

  useEffect(() => {
    seedCartCount(initialCount);
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
      aria-label={shown > 0 ? `Cart, ${shown} ${shown === 1 ? "item" : "items"}` : "Cart"}
      aria-haspopup="dialog"
      data-testid="cart-button"
      className={cn(buttonVariants({ variant: "ghost", size: "md" }), "relative min-w-12 p-0", className)}
    >
      <Icon name="bag" className="size-6" />
      {shown > 0 ? (
        <span
          aria-hidden="true"
          data-testid="cart-count"
          className="absolute top-1 right-0.5 grid min-w-5 place-items-center rounded-full border-token bg-accent px-1 text-xs leading-5 font-bold text-on-accent tabular-nums"
        >
          {shown > 99 ? "99+" : shown}
        </span>
      ) : null}
    </Link>
  );
}
