import type { Metadata } from "next";
import Link from "next/link";

import { OrderSummaryList } from "@/components/orders/OrderSummaryList";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { ACCOUNT_ORDERS_PAGE_SIZE, listAccountOrders } from "@/server/services/customer-orders";

/** Session-gated and dynamic: exempt from instant-navigation validation (see the area layout). */
export const instant = false;

export const metadata: Metadata = { title: "Your orders" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const page = Math.min(Math.max(Number.parseInt(first(query.page) ?? "1", 10) || 1, 1), 500);
  const { user } = await requireCustomer({ next: "/account/orders" });
  const history = await listAccountOrders(
    getDb(),
    { kind: "account", userId: user.id, email: user.emailVerified ? user.email : null },
    { limit: ACCOUNT_ORDERS_PAGE_SIZE, offset: (page - 1) * ACCOUNT_ORDERS_PAGE_SIZE },
  );
  const pages = Math.max(1, Math.ceil(history.total / ACCOUNT_ORDERS_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight display-fx sm:text-4xl">Your orders</h1>
        <p className="text-base text-ink-muted">
          Orders placed with this account, and orders placed as a guest with {user.email}.
        </p>
      </header>
      <Card as="section" aria-label="Orders">
        <OrderSummaryList
          orders={history.orders}
          empty={
            <div className="flex flex-col items-start gap-3">
              <p className="text-base text-ink-muted">No orders yet. When you place one, it shows up here.</p>
              <Button asChild>
                <Link href="/shop">Start shopping</Link>
              </Button>
            </div>
          }
        />
      </Card>
      {pages > 1 ? (
        <nav aria-label="Pages of orders" className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Button asChild variant="secondary" size="sm" iconStart="chevron-left">
              <Link href={`/account/orders?page=${page - 1}`}>Newer</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-sm text-ink-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Button asChild variant="secondary" size="sm" iconEnd="chevron-right">
              <Link href={`/account/orders?page=${page + 1}`}>Older</Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
