import type { Metadata } from "next";
import Link from "next/link";

import { OrderRow } from "@/components/account/OrderRow";
import { Button, Card, CardBody, CardTitle, Icon, type IconName } from "@/components/ui";
import { requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getCustomerProfile, listAddresses, listCustomerOrders } from "@/server/services/accounts";

export const metadata: Metadata = { title: "Your account" };

const QUICK_LINKS: { href: string; label: string; hint: string; icon: IconName }[] = [
  {
    href: "/account/orders",
    label: "Orders",
    hint: "Status, invoices and tracking",
    icon: "package",
  },
  { href: "/account/addresses", label: "Addresses", hint: "Where we deliver", icon: "map-pin" },
  {
    href: "/account/profile",
    label: "Profile",
    hint: "Name, mobile and preferences",
    icon: "user",
  },
  { href: "/wishlist", label: "Wishlist", hint: "Saved on every device", icon: "heart" },
  {
    href: "/account/privacy",
    label: "Privacy and data",
    hint: "Download or delete your data",
    icon: "shield-check",
  },
];

export default async function AccountOverviewPage() {
  const { user } = await requireCustomer();
  const db = getDb();
  const [profile, recent, addresses] = await Promise.all([
    getCustomerProfile(db, user.id),
    listCustomerOrders(db, user.id, { page: 1, pageSize: 3 }),
    listAddresses(db, user.id),
  ]);
  const firstName = profile?.name.trim().split(/\s+/)[0] ?? "";

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1
          className="font-display text-3xl leading-tight display-fx sm:text-4xl"
          data-testid="account-greeting"
        >
          {firstName ? `Hi, ${firstName}` : "Welcome"}
        </h1>
        {firstName ? null : (
          <p className="text-base text-ink-muted">
            Your account is ready.{" "}
            <Link
              href="/account/profile"
              className="text-link underline underline-offset-4 hover:no-underline"
            >
              Add your name
            </Link>{" "}
            so we can address you properly.
          </p>
        )}
      </header>

      <section aria-labelledby="recent-orders" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="recent-orders" className="font-display text-2xl leading-tight">
            Recent orders
          </h2>
          {recent.total > 0 ? (
            <Link
              href="/account/orders"
              className="inline-flex min-h-11 items-center text-link underline underline-offset-4 hover:no-underline"
            >
              View all orders
            </Link>
          ) : null}
        </div>
        {recent.orders.length === 0 ? (
          <Card>
            <CardBody className="items-start gap-3">
              <p className="text-ink-muted">
                No orders in your account yet. Orders you place while signed in, and earlier guest
                orders made with {profile?.email ?? "this email"}, show up here.
              </p>
              <Button asChild variant="secondary">
                <Link href="/shop">Browse the shop</Link>
              </Button>
            </CardBody>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="recent-orders">
            {recent.orders.map((order) => (
              <li key={order.ref}>
                <OrderRow order={order} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="quick-links">
        <h2 id="quick-links" className="sr-only">
          Your account
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {QUICK_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex min-h-11 items-center gap-3 rounded-card border-token bg-surface p-4 shadow-card hover:bg-surface-2"
              >
                <span className="grid size-10 flex-none place-items-center rounded-full bg-surface-2">
                  <Icon name={link.icon} className="size-5" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <CardTitle as="p" className="text-lg">
                    {link.label}
                    {link.href === "/account/addresses" && addresses.length > 0 ? (
                      <span className="ml-2 text-sm font-normal text-ink-muted">
                        ({addresses.length} saved)
                      </span>
                    ) : null}
                  </CardTitle>
                  <span className="text-sm text-ink-muted">{link.hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
