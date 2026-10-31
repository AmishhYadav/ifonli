import Link from "next/link";

import { Badge, Button, Card, CardBody, CardTitle, Icon, type BadgeTone } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { getDb } from "@/server/db";
import { resolveImageUrl } from "@/server/services/media";
import type { CustomerOrderView } from "@/server/services/orders";
import { estimateOrderDelivery } from "@/server/services/tracking";

import { AmountBreakdown } from "./AmountBreakdown";
import { addressLines, formatDateRange, formatDateTime } from "./format";
import { OrderLines } from "./OrderLines";
import { OrderTimeline } from "./OrderTimeline";
import { PayNowPanel } from "./PayNowPanel";

/**
 * How the order is being viewed:
 *  - `guest`: through the `?t=` link in the confirmation e-mail (`token` is that link's token);
 *  - `account`: by the signed-in owner under /account/orders/[ref]. Only the token's hash is stored,
 *    so there is no raw token here: an unpaid order is finished from the e-mail link, and the invoice
 *    comes from the owner-checked account route.
 */
export type OrderViewMode = { kind: "guest"; token: string } | { kind: "account" };

export const STATUS_TONE: Record<CustomerOrderView["statusLabel"], BadgeTone> = {
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

/** Sign-in link for a guest order: e-mail prefilled, and the order is the first thing they see. */
function createAccountHref(order: CustomerOrderView): string {
  const next = `/account/orders/${encodeURIComponent(order.ref)}`;
  return `/account/login?email=${encodeURIComponent(order.email)}&next=${encodeURIComponent(next)}`;
}

/** The order's status, items, amounts, delivery and help. Shared by the guest link and the account. */
export async function OrderDetail({
  order,
  mode,
}: {
  order: CustomerOrderView;
  mode: OrderViewMode;
}) {
  const db = getDb();
  const account = mode.kind === "account";
  const invoiceReady =
    order.status === "confirmed" || order.status === "processing" || order.status === "completed";
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

      {waiting && mode.kind === "guest" ? (
        <PayNowPanel
          orderRef={order.ref}
          token={mode.token}
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

          {order.shipment ? (
            <Card as="section" aria-labelledby="order-shipment">
              <CardTitle id="order-shipment" as="h2" className="mb-3">
                Shipment
              </CardTitle>
              <CardBody className="gap-1" data-testid="order-shipment">
                <p className="flex items-start gap-2">
                  <Icon name="truck" className="mt-0.5 size-4 flex-none" />
                  <span>
                    {order.shipment.courier}
                    {order.shipment.awb ? (
                      <>
                        {" "}
                        <span className="text-ink-muted">tracking no.</span>{" "}
                        <strong className="tabular-nums">{order.shipment.awb}</strong>
                      </>
                    ) : null}
                  </span>
                </p>
                {order.shipment.trackingUrl ? (
                  <a
                    href={order.shipment.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 text-link underline underline-offset-4 hover:no-underline"
                  >
                    Track with the courier
                    <Icon name="external-link" className="size-4" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

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
              <div className="mt-2 flex flex-col gap-2" data-testid="order-later-actions">
                {account ? (
                  invoiceReady ? (
                    <Button variant="secondary" iconStart="copy" asChild>
                      <a href={`/api/account/orders/${encodeURIComponent(order.ref)}/invoice`}>
                        Download invoice
                      </a>
                    </Button>
                  ) : (
                    <Button variant="secondary" disabled iconStart="copy">
                      Download invoice
                    </Button>
                  )
                ) : (
                  <Button variant="secondary" disabled iconStart="copy">
                    Download invoice
                  </Button>
                )}
                <Button variant="secondary" disabled iconStart="alert-circle">
                  Report a problem
                </Button>
                {account ? null : order.hasAccount ? (
                  <Button variant="secondary" iconStart="user" asChild>
                    <Link href={`/account/orders/${encodeURIComponent(order.ref)}`}>
                      View in your account
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" iconStart="user" asChild>
                    <Link href={createAccountHref(order)}>Create an account</Link>
                  </Button>
                )}
                <p className="text-sm text-ink-muted">
                  {account
                    ? invoiceReady
                      ? "Problem reports are coming soon. Until then, contact us from the help page."
                      : "Your invoice is issued once the order is confirmed. Problem reports are coming soon; until then, contact us from the help page."
                    : order.hasAccount
                      ? "Invoice download and problem reports are coming soon. Until then, contact us from the help page."
                      : `We'll email a sign-in code to ${order.email}. No password needed, and this order will be waiting in your account. Invoice download and problem reports are coming soon.`}
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
