import type { Metadata } from "next";
import Link from "next/link";

import { OrderDetail } from "@/components/orders/OrderDetail";
import { Button, EmptyState, Icon } from "@/components/ui";
import { requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getOrderForUser } from "@/server/services/orders";

export const metadata: Metadata = { title: "Your order" };

export default async function AccountOrderPage({ params }: { params: Promise<{ ref: string }> }) {
  const [{ user }, { ref }] = await Promise.all([requireCustomer(), params]);
  const order = await getOrderForUser(getDb(), decodeURIComponent(ref), user.id);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/account/orders"
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-link underline underline-offset-4 hover:no-underline"
      >
        <Icon name="arrow-left" className="size-4" />
        All orders
      </Link>
      {order ? (
        <OrderDetail order={order} mode={{ kind: "account" }} />
      ) : (
        <div data-testid="order-not-found">
          <h1 className="sr-only">Your order</h1>
          <EmptyState
            icon="search"
            headingLevel="h2"
            title="We couldn't find that order"
            action={
              <Button asChild>
                <Link href="/account/orders">Back to your orders</Link>
              </Button>
            }
          >
            It may belong to a different account, or the reference may be mistyped.
          </EmptyState>
        </div>
      )}
    </div>
  );
}
