"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { Icon } from "@/components/ui/Icon";
import { DEFAULT_VIBE_CYCLE, type Vibe } from "@/features/vibe/config";
import { HandButton } from "@/features/vibe/HandButton";
import { cn } from "@/lib/cn";

import { Logo } from "./Logo";

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 rounded-input px-2 text-sm font-semibold text-link underline underline-offset-4 hover:no-underline";

const bar = "mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-3 px-4 py-1 sm:px-6";

/**
 * The brand lockup, the same as the storefront header: the hand (it still switches the theme) and the wordmark
 * with the vibe's tagline. It is the only identity these pages keep; there is no promo bar or nav pills.
 */
function Brand({ cycle }: { cycle: readonly Vibe[] }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <HandButton cycle={cycle} className="header-hand" />
      <Logo tagline className="ml-1" />
    </div>
  );
}

/** Checkout only (plan section 10): nothing to distract from paying. Logo, a trust cue, a way back to the bag. */
function CheckoutBar({ cycle }: { cycle: readonly Vibe[] }) {
  return (
    <div className={bar}>
      <Brand cycle={cycle} />
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Icon name="lock" className="size-4" />
        Secure checkout
      </p>
      <Link href="/cart" className={linkClass}>
        <Icon name="arrow-left" className="size-4" />
        Back to bag
      </Link>
    </div>
  );
}

/**
 * Cart, order confirmation and tracking: the same plain frame, but with ways back into the shop. No "Secure
 * checkout" cue (these pages are not the payment step) and no link to the page you are already on.
 */
function ShopBar({ pathname, cycle }: { pathname: string | null; cycle: readonly Vibe[] }) {
  const onCart = pathname === "/cart";
  const onTrack = pathname === "/track";
  return (
    <div className={bar}>
      <Brand cycle={cycle} />
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
            Bag
          </Link>
        )}
      </nav>
    </div>
  );
}

function Bar({ cycle }: { cycle: readonly Vibe[] }) {
  const pathname = usePathname();
  return pathname === "/checkout" || pathname?.startsWith("/checkout/") ? (
    <CheckoutBar cycle={cycle} />
  ) : (
    <ShopBar pathname={pathname} cycle={cycle} />
  );
}

/**
 * Header of the (buy) route group. Checkout gets the minimal secure header; cart, orders and tracking get a
 * plain header with links back to the shop. The pathname is not known while `/orders/[ref]` prerenders, so
 * the fallback is the shop variant (the right one for orders); `/checkout` is a static route and resolves
 * on the server.
 */
export function BuyHeader({ cycle = DEFAULT_VIBE_CYCLE }: { cycle?: readonly Vibe[] }) {
  return (
    <header className="border-b border-hairline bg-bg">
      <Suspense fallback={<ShopBar pathname={null} cycle={cycle} />}>
        <Bar cycle={cycle} />
      </Suspense>
    </header>
  );
}
