import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AmountBreakdown } from "@/components/orders/AmountBreakdown";
import { addressLines, formatDateRange, formatDateTime } from "@/components/orders/format";
import { OrderLines } from "@/components/orders/OrderLines";
import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { PayNowPanel } from "@/components/orders/PayNowPanel";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  Icon,
  Skeleton,
  type BadgeTone,
} from "@/components/ui";
import { formatINR } from "@/lib/money";
import { getDb } from "@/server/db";
import { resolveImageUrl } from "@/server/services/media";
import { getOrderForCustomer, type CustomerOrderView } from "@/server/services/orders";
import { estimateOrderDelivery } from "@/server/services/tracking";

/**
 * Order confirmation and status. Reached through the `?t=` link, so: no indexing, no caching, and the
 * link is not leaked to other sites through the Referer header.
 */
export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const STATUS_TONE: Record<CustomerOrderView["statusLabel"], BadgeTone> = {
  "Payment pending": "warning",
  Confirmed: "success",
  Packed: "success",
  Shipped: "success",
  "Out for delivery": "success",
  Delivered: "success",
  Cancelled: "danger",
  Refunded: "neutral",
};

function headline(order: CustomerOrderView): string {
  switch (order.statusLabel) {
    case "Payment pending":
      return "Complete your payment";
    case "Cancelled":
      return "This order was cancelled";
    case "Refunded":
      return "This order was refunded";
    case "Delivered":
      return "Your order was delivered";
    case "Confirmed":
      return "Thank you, your order is confirmed";
    default:
      return `Your order is ${order.statusLabel.toLowerCase()}`;
  }
}

function nextSteps(order: CustomerOrderView): string {
  const cod = order.paymentMethod === "cod";
  switch (order.statusLabel) {
    case "Payment pending":
      return "Your items are held for a short time while we wait for the payment.";
    case "Confirmed":
      return cod
        ? `We've received your order. Please keep ${formatINR(order.totalPaise)} ready to pay when it arrives. We'll email updates to ${order.email}.`
        : `We've received your payment. We're getting your order ready and will email updates to ${order.email}.`;
    case "Packed":
      return "Your order is packed and waiting for the courier. You'll get the tracking details by email.";
    case "Shipped":
    case "Out for delivery":
      return "Your order is on its way. You can follow it on the tracking page.";
    case "Delivered":
      return "We hope you like it. If anything is wrong with your order, get in touch and we'll help.";
    case "Cancelled":
      return "If you were charged for this order, the amount goes back to your original payment method.";
    case "Refunded":
      return "Your refund has been issued to your original payment method. Banks can take a few working days to show it.";
  }
}

function paymentLine(order: CustomerOrderView): string {
  if (order.paymentMethod === "cod") {
    switch (order.paymentStatus) {
      case "cod_collected":
        return "Cash on delivery: paid";
      case "failed":
        return "Cash on delivery: not collected";
      case "refunded":
      case "partially_refunded":
        return "Cash on delivery: refunded";
      default:
        return `Cash on delivery: pay ${formatINR(order.totalPaise)} when it arrives`;
    }
  }
  switch (order.paymentStatus) {
    case "paid":
      return "Paid online";
    case "partially_refunded":
      return "Paid online (partly refunded)";
    case "refunded":
      return "Paid online (refunded)";
    default:
      return order.status === "pending_payment"
        ? "Online payment: waiting for payment"
        : "Online payment: not completed";
  }
}

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

  const open = order.status === "confirmed" || order.status === "processing";
  const delivery =
    open && order.fulfillmentStatus !== "delivered"
      ? await estimateOrderDelivery(db, order.shippingAddress, order.paidAt ?? order.placedAt)
      : null;
  const waiting = order.status === "pending_payment" && order.paymentMethod === "razorpay";
  const holdUntil = order.expiresAt
    ? new Intl.DateTimeFormat("en-IN", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      })
        .format(order.expiresAt)
        .toLowerCase()
    : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1
          className="font-display text-3xl leading-tight sm:text-4xl"
          data-testid="order-headline"
        >
          {headline(order)}
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base">
          <span>
            Order <strong data-testid="order-ref">{order.ref}</strong>
          </span>
          <Badge tone={STATUS_TONE[order.statusLabel]} data-testid="order-status">
            {order.statusLabel}
          </Badge>
          <span className="text-ink-muted">Placed {formatDateTime(order.placedAt)}</span>
        </p>
        <p className="max-w-prose text-base text-ink-muted">{nextSteps(order)}</p>
      </header>

      {waiting ? (
        <PayNowPanel
          orderRef={order.ref}
          token={token}
          email={order.email}
          amountLabel={formatINR(order.totalPaise)}
          holdUntil={holdUntil}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Card as="section" aria-labelledby="order-items">
            <CardTitle id="order-items" as="h2" className="mb-4">
              Items
            </CardTitle>
            <OrderLines
              lines={order.items.map((item, i) => ({
                key: `${item.sku}-${i}`,
                name: item.productName,
                variantTitle: item.variantTitle,
                qty: item.qty,
                lineTotalPaise: item.lineTotalPaise,
                imageUrl: item.imagePath ? safeImageUrl(item.imagePath) : null,
              }))}
            />
          </Card>

          <Card as="section" aria-labelledby="order-history">
            <CardTitle id="order-history" as="h2" className="mb-4">
              Order history
            </CardTitle>
            <OrderTimeline events={order.events} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card as="section" aria-labelledby="order-amounts">
            <CardTitle id="order-amounts" as="h2" className="mb-4">
              Payment summary
            </CardTitle>
            <CardBody>
              <AmountBreakdown
                subtotalPaise={order.subtotalPaise}
                discountPaise={order.discountPaise}
                shippingPaise={order.shippingPaise}
                codFeePaise={order.codFeePaise}
                totalPaise={order.totalPaise}
                taxIncludedPaise={order.taxIncludedPaise}
              />
              <p className="text-sm text-ink-muted" data-testid="payment-line">
                {paymentLine(order)}
              </p>
            </CardBody>
          </Card>

          <Card as="section" aria-labelledby="order-address">
            <CardTitle id="order-address" as="h2" className="mb-3">
              Delivery
            </CardTitle>
            <CardBody className="gap-1">
              <address className="not-italic" data-testid="order-address">
                {addressLines(order.shippingAddress).map((line, i) => (
                  <span key={i} className="block">
                    {line}
                  </span>
                ))}
              </address>
              {delivery ? (
                <p className="mt-2 flex items-start gap-2 text-sm text-ink-muted">
                  <Icon name="truck" className="mt-0.5 size-4 flex-none" />
                  Estimated delivery {formatDateRange(delivery.fromDate, delivery.toDate)}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card as="section" aria-labelledby="order-help">
            <CardTitle id="order-help" as="h2" className="mb-3">
              Need help?
            </CardTitle>
            <CardBody className="gap-2">
              <ul className="flex flex-col">
                {[
                  { href: "/track", label: "Track an order" },
                  { href: "/policies/shipping", label: "Shipping policy" },
                  { href: "/policies/returns-refunds", label: "Returns and refunds" },
                  { href: "/help", label: "Help and contact" },
                ].map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-flex min-h-11 items-center text-link underline underline-offset-4 hover:no-underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
              {/* Later phases: these switch on when invoices, support cases and accounts exist. */}
              <div className="mt-2 flex flex-col gap-2" data-testid="order-later-actions">
                <Button variant="secondary" disabled iconStart="copy">
                  Download invoice
                </Button>
                <Button variant="secondary" disabled iconStart="alert-circle">
                  Report a problem
                </Button>
                <Button variant="secondary" disabled iconStart="user">
                  Create an account
                </Button>
                <p className="text-sm text-ink-muted">
                  These are coming soon. Until then, contact us from the help page.
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** A bad stored path must never take the whole order page down. */
function safeImageUrl(path: string): string | null {
  try {
    return resolveImageUrl(path);
  } catch {
    return null;
  }
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
