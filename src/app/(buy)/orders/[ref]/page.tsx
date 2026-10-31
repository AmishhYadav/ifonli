import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { OrderDetail } from "@/components/orders/OrderDetail";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { getDb } from "@/server/db";
import { getOrderForCustomer } from "@/server/services/orders";

/**
 * Order confirmation and status. Reached through the `?t=` link, so: no indexing, no caching, and the
 * link is not leaked to other sites through the Referer header. The page body is `OrderDetail`,
 * shared with the signed-in view under /account/orders/[ref].
 */
export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function NotFoundCard() {
  return (
    <div className="mx-auto max-w-xl py-6" data-testid="order-not-found">
      <h1 className="sr-only">Your order</h1>
      <EmptyState
        icon="search"
        headingLevel="h2"
        title="We couldn't find that order"
        action={
          <Button asChild>
            <Link href="/track">Track an order</Link>
          </Button>
        }
      >
        This link may be incomplete or out of date. You can look up your order with its reference
        and the email or phone number you used.
      </EmptyState>
    </div>
  );
}

function OrderSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading your order"
      className="flex flex-col gap-4"
    >
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

async function OrderContent({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ ref }, query] = await Promise.all([params, searchParams]);
  const token = first(query.t) ?? "";
  const order = await getOrderForCustomer(getDb(), decodeURIComponent(ref), token);
  if (!order) return <NotFoundCard />;
  return <OrderDetail order={order} mode={{ kind: "guest", token }} />;
}

export default function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<OrderSkeleton />}>
      <OrderContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
