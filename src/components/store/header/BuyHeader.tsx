"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { Icon } from "@/components/ui";
import { cn } from "@/lib/cn";

import { Logo } from "./Logo";

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 rounded-input px-2 text-sm font-semibold text-link underline underline-offset-4 hover:no-underline";

const bar = "mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6";

/** Checkout only (plan section 10): nothing to distract from paying. Logo, a trust cue, a way back to the cart. */
function CheckoutBar() {
  return (
    <div className={bar}>
      <Logo />
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Icon name="lock" className="size-4" />
        Secure checkout
      </p>
      <Link href="/cart" className={linkClass}>
        <Icon name="arrow-left" className="size-4" />
        Back to cart
      </Link>
    </div>
  );
}

/**
 * Cart, order confirmation and tracking: the same plain frame, but with ways back into the shop. No "Secure
 * checkout" cue (these pages are not the payment step) and no link to the page you are already on.
 */
function ShopBar({ pathname }: { pathname: string | null }) {
  const onCart = pathname === "/cart";
  const onTrack = pathname === "/track";
  return (
    <div className={bar}>
      <Logo />
      <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-3">
        <Link href="/shop" className={linkClass}>
          Shop
        </Link>
        {onTrack ? null : (
          <Link href="/track" className={linkClass}>
            Track an order
          </Link>
        )}
        {onCart ? null : (
          <Link href="/cart" className={cn(linkClass, "gap-1")}>
            <Icon name="bag" className="size-4" />
            Cart
          </Link>
        )}
      </nav>
    </div>
  );
}

function Bar() {
  const pathname = usePathname();
  return pathname === "/checkout" || pathname?.startsWith("/checkout/") ? (
    <CheckoutBar />
  ) : (
    <ShopBar pathname={pathname} />
  );
}

/**
 * Header of the (buy) route group. Checkout gets the minimal secure header; cart, orders and tracking get a
 * plain header with links back to the shop. The pathname is not known while `/orders/[ref]` prerenders, so
 * the fallback is the shop variant (the right one for orders); `/checkout` is a static route and resolves
 * on the server.
 */
export function BuyHeader() {
  return (
    <header className="border-b border-border bg-bg">
      <Suspense fallback={<ShopBar pathname={null} />}>
        <Bar />
      </Suspense>
    </header>
  );
}
