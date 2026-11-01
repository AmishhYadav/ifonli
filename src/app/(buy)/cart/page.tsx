import type { Metadata } from "next";
import { Suspense } from "react";

import { CartPageView } from "@/components/store/cart/CartPageView";
import { getReturnPolicySummary } from "@/components/store/cart/policy";
import { VibeCopy } from "@/components/store/VibeCopy";
import { Skeleton } from "@/components/ui/Skeleton";
import { getCurrentCartView } from "@/features/cart/queries";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: false },
  alternates: { canonical: "/cart" },
};

function CartSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-5">
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-4">
            <Skeleton shape="block" className="size-24 flex-none" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton shape="text" className="w-2/3" />
              <Skeleton shape="text" className="w-1/4" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton shape="card" className="h-72" />
    </div>
  );
}

/** Reads the cart cookie (dynamic), so it lives in a Suspense hole; the heading around it is static. */
async function CartContent() {
  const [cart, returns] = await Promise.all([getCurrentCartView(), getReturnPolicySummary()]);
  return (
    <CartPageView
      initial={cart}
      returnPolicyText={returns.text}
      emptyTitle={<VibeCopy k="cart.emptyTitle" as="span" />}
      emptyBody={<VibeCopy k="cart.emptyBody" as="span" />}
    />
  );
}

export default function CartPage() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold sm:text-4xl">Your cart</h1>
      <Suspense fallback={<CartSkeleton />}>
        <CartContent />
      </Suspense>
    </>
  );
}
