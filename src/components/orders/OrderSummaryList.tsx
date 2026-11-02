import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { formatINR } from "@/lib/money";
import { resolveImageUrl } from "@/server/services/media";
import type { AccountOrderSummary } from "@/server/services/customer-orders";

import { formatDateTime } from "./format";

const TONE: Record<AccountOrderSummary["statusLabel"], BadgeTone> = {
  "Payment pending": "warning",
  Confirmed: "success",
  Packed: "success",
  Shipped: "success",
  "Out for delivery": "success",
  Delivered: "success",
  Cancelled: "danger",
  Refunded: "neutral",
};

function thumb(path: string): string | null {
  try {
    return resolveImageUrl(path);
  } catch {
    return null;
  }
}

/** A list of the customer's orders: thumbnails, items, status, total. Each row links to its detail page. */
export function OrderSummaryList({
  orders,
  empty,
}: {
  orders: readonly AccountOrderSummary[];
  empty: ReactNode;
}) {
  if (orders.length === 0) return <>{empty}</>;
  return (
    <ul className="flex flex-col divide-y divide-hairline" data-testid="account-orders">
      {orders.map((order) => {
        const extra = order.itemCount - order.itemNames.length;
        return (
          <li key={order.ref}>
            <Link
              href={`/account/orders/${encodeURIComponent(order.ref)}`}
              className="flex min-h-11 items-center gap-4 py-4 hover:bg-surface-2 focus-visible:bg-surface-2"
              data-testid="account-order-link"
            >
              <span className="flex flex-none -space-x-3" aria-hidden="true">
                {order.imagePaths.length === 0 ? (
                  <span className="grid size-14 place-items-center rounded-input art-none text-ink-muted">
                    <Icon name="package" className="size-6" />
                  </span>
                ) : (
                  order.imagePaths.map((path, i) => {
                    const url = thumb(path);
                    return (
                      <span
                        key={`${path}-${i}`}
                        className="relative size-14 overflow-hidden rounded-input art-none"
                      >
                        {url ? <Image src={url} alt="" fill sizes="56px" className="object-cover" /> : null}
                      </span>
                    );
                  })
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <strong className="text-base">{order.ref}</strong>
                  <Badge tone={TONE[order.statusLabel]}>{order.statusLabel}</Badge>
                </span>
                <span className="truncate text-sm text-ink-muted">
                  {order.itemNames.join(", ")}
                  {extra > 0 ? ` and ${extra} more` : ""}
                </span>
                <span className="text-sm text-ink-muted">
                  {formatDateTime(order.placedAt)}
                  {order.paymentMethod === "cod" ? " · Cash on delivery" : ""}
                </span>
              </span>
              <span className="flex flex-none items-center gap-2">
                <span className="text-base font-semibold tabular-nums">{formatINR(order.totalPaise)}</span>
                <Icon name="chevron-right" className="size-5 text-ink-muted" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
