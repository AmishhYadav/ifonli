import Link from "next/link";

import { Button, EmptyState } from "@/components/ui";

/** Shown instead of the form while the shop is not taking orders (production launch gate). */
export function ClosedCheckout({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-xl py-6" data-testid="checkout-closed">
      <EmptyState
        icon="info"
        headingLevel="h2"
        title="We're not taking orders yet"
        action={
          <Button asChild>
            <Link href="/shop">Keep browsing</Link>
          </Button>
        }
      >
        {message ?? "We're still getting the shop ready, so please check back soon."}
      </EmptyState>
    </div>
  );
}
