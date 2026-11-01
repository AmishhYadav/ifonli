import type { Metadata } from "next";
import Link from "next/link";

import { OrderSummaryList } from "@/components/orders/OrderSummaryList";
import { addressLines } from "@/components/orders/format";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardTitle } from "@/components/ui/Card";
import { requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getProfile, listAddresses } from "@/server/services/account";
import { listAccountOrders } from "@/server/services/customer-orders";

/** Session-gated and dynamic: exempt from instant-navigation validation (see the area layout). */
export const instant = false;

export const metadata: Metadata = { title: "Your account" };

export default async function AccountOverviewPage() {
  const { user } = await requireCustomer({ next: "/account" });
  const db = getDb();
  const access = { kind: "account", userId: user.id, email: user.emailVerified ? user.email : null } as const;
  const [profile, addresses, history] = await Promise.all([
    getProfile(db, user.id),
    listAddresses(db, user.id),
    listAccountOrders(db, access, { limit: 3 }),
  ]);
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const name = profile?.name.trim();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight display-fx sm:text-4xl" data-testid="account-heading">
          {name ? `Hi, ${name.split(/\s+/)[0]}` : "Your account"}
        </h1>
        <p className="text-base text-ink-muted">Signed in as {user.email}.</p>
        {!name ? (
          <p className="text-base">
            <Link href="/account/profile" className="text-link underline underline-offset-4 hover:no-underline">
              Add your name
            </Link>{" "}
            so we can greet you properly.
          </p>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <Card as="section" aria-labelledby="recent-orders">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle id="recent-orders" as="h2">
              Recent orders
            </CardTitle>
            {history.total > 3 ? (
              <Link
                href="/account/orders"
                className="inline-flex min-h-11 items-center text-link underline underline-offset-4 hover:no-underline"
              >
                See all {history.total}
              </Link>
            ) : null}
          </div>
          <OrderSummaryList
            orders={history.orders}
            empty={
              <div className="flex flex-col items-start gap-3">
                <p className="text-base text-ink-muted">You haven&apos;t placed an order with this account yet.</p>
                <Button asChild>
                  <Link href="/shop">Start shopping</Link>
                </Button>
              </div>
            }
          />
        </Card>

        <div className="flex flex-col gap-6">
          <Card as="section" aria-labelledby="default-address">
            <CardTitle id="default-address" as="h2" className="mb-3">
              Delivery address
            </CardTitle>
            <CardBody className="gap-3">
              {defaultAddress ? (
                <address className="not-italic">
                  {addressLines(defaultAddress).map((line, i) => (
                    <span key={i} className="block">
                      {line}
                    </span>
                  ))}
                </address>
              ) : (
                <p className="text-base text-ink-muted">No saved address yet. Save one and checkout fills itself in.</p>
              )}
              <div>
                <Button asChild variant="secondary" size="sm">
                  <Link href="/account/addresses">{defaultAddress ? "Manage addresses" : "Add an address"}</Link>
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card as="section" aria-labelledby="your-data">
            <CardTitle id="your-data" as="h2" className="mb-3">
              Your details
            </CardTitle>
            <CardBody className="gap-3">
              <p className="text-base text-ink-muted">
                Update your name and phone number, download your data, or delete your account.
              </p>
              <div>
                <Button asChild variant="secondary" size="sm">
                  <Link href="/account/profile">Profile and privacy</Link>
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
