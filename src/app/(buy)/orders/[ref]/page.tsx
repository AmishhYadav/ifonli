import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { OrderDetailView } from "@/components/orders/OrderDetailView";
import { RefreshCartBadge } from "@/components/orders/RefreshCartBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { getOptionalCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { loadOrderPageExtras } from "@/server/services/order-page";
import { getOrderForCustomer } from "@/server/services/orders";

/**
 * Order confirmation and status. Reached through the `?t=` link, so: no indexing, no caching, and the
 * link is not leaked to other sites through the Referer header. The body is shared with the signed-in
 * `/account/orders/[ref]` page (`OrderDetailView`).
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
  const db = getDb();
  const order = await getOrderForCustomer(db, decodeURIComponent(ref), token);
  if (!order) return <NotFoundCard />;

  const [extras, customer] = await Promise.all([loadOrderPageExtras(db, order), getOptionalCustomer()]);
  return (
    <>
      <RefreshCartBadge />
      <OrderDetailView
        order={order}
        extras={extras}
        access={{ kind: "token", token }}
        signedIn={customer !== null}
      />
    </>
  );
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
