import type { Metadata } from "next";
import Link from "next/link";

import { OrderRow } from "@/components/account/OrderRow";
import { Button, EmptyState } from "@/components/ui";
import { ORDERS_PAGE_SIZE, parsePageParam } from "@/features/account/schema";
import { requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listCustomerOrders } from "@/server/services/accounts";

export const metadata: Metadata = { title: "Your orders" };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ user }, query] = await Promise.all([requireCustomer(), searchParams]);
  const result = await listCustomerOrders(getDb(), user.id, {
    page: parsePageParam(query.page),
    pageSize: ORDERS_PAGE_SIZE,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl leading-tight display-fx sm:text-4xl">Your orders</h1>
      {result.total === 0 ? (
        <EmptyState
          icon="package"
          title="No orders yet"
          action={
            <Button asChild>
              <Link href="/shop">Browse the shop</Link>
            </Button>
          }
        >
          Orders you place while signed in, and earlier guest orders made with your email, show up
          here.
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3" data-testid="orders-list">
            {result.orders.map((order) => (
              <li key={order.ref}>
                <OrderRow order={order} />
              </li>
            ))}
          </ul>
          {result.pageCount > 1 ? (
            <nav aria-label="Orders pages" className="flex items-center justify-between gap-3">
              {result.page > 1 ? (
                <Button asChild variant="secondary" size="sm" iconStart="chevron-left">
                  <Link href={`/account/orders?page=${result.page - 1}`}>Newer orders</Link>
                </Button>
              ) : (
                <span />
              )}
              <p className="text-sm text-ink-muted">
                Page {result.page} of {result.pageCount}
              </p>
              {result.page < result.pageCount ? (
                <Button asChild variant="secondary" size="sm" iconEnd="chevron-right">
                  <Link href={`/account/orders?page=${result.page + 1}`}>Older orders</Link>
                </Button>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
