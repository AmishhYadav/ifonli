import { unstable_rethrow } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { CartDrawer } from "@/components/store/cart/CartDrawer";
import { CartTrigger } from "@/components/store/cart/CartTrigger";
import { getReturnPolicySummary } from "@/components/store/cart/policy";
import { VibeCopy } from "@/components/store/VibeCopy";
import { getCurrentCartCount } from "@/features/cart/queries";

/** Reads the visitor's cart cookie, so it is a dynamic hole: the header around it stays in the static shell. */
async function LiveCartTrigger({ className }: { className?: string }) {
  let count = 0;
  try {
    count = await getCurrentCartCount();
  } catch (error) {
    // Let Next's own control-flow errors (prerender bail-out on `cookies()`) through.
    unstable_rethrow(error);
    // A cart read must never take the header (and the page) down: show no badge.
    console.error("CartButton: could not read the cart count", error);
  }
  return <CartTrigger initialCount={count} className={className} />;
}

/**
 * Header cart entry: a link to /cart with the live item count that opens the cart drawer. Server
 * component: the trigger streams in from a Suspense hole (cookie read), the drawer is static markup around
 * client state. Keeps the `className` prop the header relies on.
 */
export async function CartButton({ className }: { className?: string }): Promise<ReactNode> {
  const policy = await getReturnPolicySummary();
  return (
    <>
      <Suspense fallback={<CartTrigger initialCount={null} className={className} />}>
        <LiveCartTrigger className={className} />
      </Suspense>
      <CartDrawer
        emptyTitle={<VibeCopy k="cart.emptyTitle" as="span" />}
        emptyBody={<VibeCopy k="cart.emptyBody" as="span" />}
        returnPolicyText={policy.text}
      />
    </>
  );
}
