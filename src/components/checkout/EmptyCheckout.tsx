import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/** Shown instead of the form when there is nothing to check out. */
export function EmptyCheckout() {
  return (
    <div className="mx-auto max-w-xl py-6">
      <EmptyState
        icon="bag"
        headingLevel="h2"
        title="Your cart is empty"
        action={
          <Button asChild>
            <Link href="/shop">Continue shopping</Link>
          </Button>
        }
      >
        Add something to your cart and it will show up here.
      </EmptyState>
    </div>
  );
}
