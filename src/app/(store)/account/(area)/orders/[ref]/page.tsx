import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderDetailView } from "@/components/orders/OrderDetailView";
import { Icon } from "@/components/ui";
import { requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getOrderForAccount } from "@/server/services/customer-orders";
import { loadOrderPageExtras } from "@/server/services/order-page";

/** Session-gated and dynamic: exempt from instant-navigation validation (see the area layout). */
export const instant = false;

export const metadata: Metadata = { title: "Your order" };

/** Same view as the guest page `/orders/[ref]?t=`, for the signed-in owner (no token needed). */
export default async function AccountOrderPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const decoded = decodeURIComponent(ref);
  const { user } = await requireCustomer({ next: `/account/orders/${encodeURIComponent(decoded)}` });
  const db = getDb();
  const order = await getOrderForAccount(db, decoded, {
    kind: "account",
    userId: user.id,
    email: user.emailVerified ? user.email : null,
  });
  // Somebody else's order is indistinguishable from one that does not exist.
  if (!order) notFound();
  const extras = await loadOrderPageExtras(db, order);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/account/orders"
        className="inline-flex min-h-11 w-fit items-center gap-1.5 text-link underline underline-offset-4 hover:no-underline"
      >
        <Icon name="arrow-left" className="size-4" />
        All orders
      </Link>
      <OrderDetailView order={order} extras={extras} access={{ kind: "account" }} signedIn />
    </div>
  );
}
