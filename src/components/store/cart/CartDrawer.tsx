"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { Button, Drawer, DrawerContent, EmptyState, Skeleton, buttonVariants, useToast } from "@/components/ui";
import type { CartView } from "@/features/cart/types";

import { refreshCart, setCartOpen, takeCartOpener } from "./cart-store";
import { CartLines } from "./CartLines";
import { CartNotices } from "./CartNotices";
import { CartTotals } from "./CartTotals";
import { EMPTY_CART_VIEW } from "./empty-cart";
import { ReturnNote } from "./ReturnNote";
import { useCartStore, useOptimisticCart } from "./useCart";

interface CartDrawerProps {
  /** Themed empty-state copy, rendered on the server with `VibeCopy`. */
  emptyTitle: ReactNode;
  emptyBody: ReactNode;
  returnPolicyText: string;
}

/** Right-hand cart drawer, driven by the cart store (opened by the header link or the "View cart" toast action). */
export function CartDrawer({ emptyTitle, emptyBody, returnPolicyText }: CartDrawerProps) {
  const { open, cart: stored, notices, error, announcement } = useCartStore();
  const { cart, pending, setQuantity, remove } = useOptimisticCart(stored ?? EMPTY_CART_VIEW);
  const { dismissAll } = useToast();
  const loaded = stored !== null;

  // The drawer shows what the "Added to cart" toast said: clear the toast so it does not cover the checkout button.
  useEffect(() => {
    if (open) dismissAll();
  }, [open, dismissAll]);
  const empty = loaded && cart.lines.length === 0;

  return (
    <Drawer open={open} onOpenChange={setCartOpen}>
      <DrawerContent
        title="Your cart"
        data-testid="cart-drawer"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          // Radix only returns focus to a <Drawer.Trigger>; this drawer is opened from the store.
          event.preventDefault();
          takeCartOpener()?.focus();
        }}
        footer={
          open && loaded ? (
            empty ? (
              <Link
                href="/shop"
                onClick={() => setCartOpen(false)}
                className={buttonVariants({ variant: "secondary", fullWidth: true })}
              >
                Continue shopping
              </Link>
            ) : (
              <DrawerFooter cart={cart} pending={pending} returnPolicyText={returnPolicyText} />
            )
          ) : null
        }
      >
        {!loaded ? (
          error ? <DrawerLoadError message={error} /> : <DrawerSkeleton />
        ) : empty ? (
          <div className="flex flex-col gap-4">
            <CartNotices notices={notices} error={error} />
            <EmptyState icon="bag" headingLevel="h3" title={emptyTitle}>
              {emptyBody}
            </EmptyState>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <CartNotices notices={notices} error={error} />
            <CartLines cart={cart} layout="drawer" onQuantity={setQuantity} onRemove={remove} />
          </div>
        )}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </DrawerContent>
    </Drawer>
  );
}

/** The first load failed: say so and let the shopper try again, rather than a skeleton that never ends. */
function DrawerLoadError({ message }: { message: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3" data-testid="cart-drawer-error">
      <p className="text-base text-ink">{message}</p>
      <Button variant="secondary" onClick={() => void refreshCart()}>
        Try again
      </Button>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4" data-testid="cart-drawer-loading">
      {[0, 1].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton shape="block" className="size-[72px] flex-none" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton shape="text" className="w-3/4" />
            <Skeleton shape="text" className="w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DrawerFooter({
  cart,
  pending,
  returnPolicyText,
}: {
  cart: CartView;
  pending: boolean;
  returnPolicyText: string;
}) {
  return (
    <>
      <div aria-busy={pending} className={pending ? "opacity-70 transition-opacity" : "transition-opacity"}>
        <CartTotals cart={cart} />
      </div>
      <ReturnNote text={returnPolicyText} />
      <Link
        href="/checkout"
        onClick={() => setCartOpen(false)}
        data-testid="drawer-checkout"
        className={buttonVariants({ size: "lg", fullWidth: true })}
      >
        Checkout
      </Link>
      <Link
        href="/cart"
        onClick={() => setCartOpen(false)}
        data-testid="drawer-view-cart"
        className={buttonVariants({ variant: "secondary", fullWidth: true })}
      >
        View cart
      </Link>
    </>
  );
}
