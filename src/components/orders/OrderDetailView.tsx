import Link from "next/link";

import { accountLoginUrl } from "@/features/account/redirect";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card, CardBody, CardTitle } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { formatINR } from "@/lib/money";
import { resolveImageUrl } from "@/server/services/media";
import type { CustomerOrderView } from "@/server/services/orders";
import type { OrderPageExtras } from "@/server/services/order-page";

import { AmountBreakdown } from "./AmountBreakdown";
import { addressLines, formatDateRange, formatDateTime } from "./format";
import { OrderActions } from "./OrderActions";
import { headline, nextSteps, paymentLine } from "./order-copy";
import { OrderLines } from "./OrderLines";
import { OrderTimeline } from "./OrderTimeline";
import { PayNowPanel } from "./PayNowPanel";

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

const CASE_TYPE: Record<string, string> = {
  damaged: "Arrived damaged",
  defective: "Faulty item",
  wrong: "Wrong item",
  missing: "Something missing",
  other: "Something else",
};
const CASE_STATUS: Record<string, string> = {
  open: "Received",
  in_progress: "Being looked at",
  resolved: "Resolved",
  rejected: "Closed",
};

/** A bad stored path must never take the whole order page down. */
function safeImageUrl(path: string): string | null {
  try {
    return resolveImageUrl(path);
  } catch {
    return null;
  }
}

export type OrderViewAccess =
  | { kind: "token"; token: string }
  | { kind: "account" };

export interface OrderDetailViewProps {
  order: CustomerOrderView;
  extras: OrderPageExtras;
  access: OrderViewAccess;
  /** A customer is signed in (so "Create an account" is not offered). */
  signedIn: boolean;
}

/**
 * The order page body, shared by the guest page (`/orders/[ref]?t=`) and the signed-in page
 * (`/account/orders/[ref]`): status, items, history, amounts, delivery and the order actions.
 */
export function OrderDetailView({ order, extras, access, signedIn }: OrderDetailViewProps) {
  const token = access.kind === "token" ? access.token : undefined;
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

  const refPath = encodeURIComponent(order.ref);
  const invoiceHref = extras.invoiceAvailable
    ? `/api/orders/${refPath}/invoice${token ? `?t=${encodeURIComponent(token)}` : ""}`
    : null;
  const createAccountHref = signedIn ? null : accountLoginUrl({ email: order.email });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1
          className="buy-display buy-display-fx text-4xl leading-tight"
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

      {waiting && token ? (
        <PayNowPanel
          orderRef={order.ref}
          token={token}
          email={order.email}
          amountLabel={formatINR(order.totalPaise)}
          holdUntil={holdUntil}
        />
      ) : waiting ? (
        <p className="flex items-start gap-2 rounded-card bg-surface shadow-card p-4 text-base" data-testid="pay-pending-note">
          <Icon name="info" className="mt-0.5 size-5 flex-none" />
          <span>
            We&apos;re waiting for your payment of {formatINR(order.totalPaise)}.
            {holdUntil ? ` Your items are held until about ${holdUntil}.` : ""} If you&apos;ve already paid,
            it can take a few minutes to confirm. To pay now, open the link in your order email, or place the
            order again.
          </span>
        </p>
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

          {extras.cases.length > 0 ? (
            <Card as="section" aria-labelledby="order-reports" data-testid="order-reports">
              <CardTitle id="order-reports" as="h2" className="mb-3">
                Your reports
              </CardTitle>
              <ul className="flex flex-col gap-2">
                {extras.cases.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 text-base">
                    <span className="font-semibold">{CASE_TYPE[c.type] ?? "Report"}</span>
                    <span className="text-ink-muted">
                      {CASE_STATUS[c.status] ?? c.status} · {formatDateTime(c.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
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
              {extras.delivery ? (
                <p className="mt-2 flex items-start gap-2 text-sm text-ink-muted" data-visual-mask>
                  <Icon name="truck" className="mt-0.5 size-4 flex-none" />
                  Estimated delivery {formatDateRange(extras.delivery.fromDate, extras.delivery.toDate)}
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
              <OrderActions
                orderRef={order.ref}
                token={token}
                email={order.email}
                paymentMethod={order.paymentMethod}
                totalPaise={order.totalPaise}
                invoiceHref={invoiceHref}
                cancel={extras.cancel}
                report={extras.report}
                createAccountHref={createAccountHref}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
