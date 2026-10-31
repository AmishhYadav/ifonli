import Image from "next/image";
import Link from "next/link";

import { STATUS_TONE } from "@/components/orders/OrderDetail";
import { formatDateTime } from "@/components/orders/format";
import { Badge, Icon } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { resolveImageUrl } from "@/server/services/media";
import type { OrderSummary } from "@/server/services/accounts";

function safeImageUrl(path: string | null): string | null {
  if (!path) return null;
  try {
    return resolveImageUrl(path);
  } catch {
    return null;
  }
}

/** One order in the history list: thumbnail, reference, status, items, total. The whole row is the link. */
export function OrderRow({ order }: { order: OrderSummary }) {
  const imageUrl = safeImageUrl(order.imagePath);
  const more = order.itemCount > order.itemNames.length ? ` and more` : "";
  return (
    <Link
      href={`/account/orders/${encodeURIComponent(order.ref)}`}
      className="flex items-center gap-4 rounded-card border-token bg-surface p-4 shadow-card hover:bg-surface-2"
      data-testid="order-row"
    >
      <span className="relative size-16 flex-none overflow-hidden rounded-card border border-border bg-surface-2">
        {imageUrl ? (
          <Image src={imageUrl} alt="" fill sizes="64px" className="object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-ink-muted">
            <Icon name="package" className="size-6" />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong className="text-base">{order.ref}</strong>
          <Badge tone={STATUS_TONE[order.statusLabel]}>{order.statusLabel}</Badge>
        </span>
        <span className="truncate text-sm text-ink-muted">
          {order.itemNames.join(", ")}
          {more}
        </span>
        <span className="text-sm text-ink-muted">Placed {formatDateTime(order.placedAt)}</span>
      </span>
      <span className="flex flex-none flex-col items-end gap-1">
        <span className="text-base font-semibold tabular-nums">{formatINR(order.totalPaise)}</span>
        <Icon name="chevron-right" className="size-5 text-ink-muted" />
      </span>
    </Link>
  );
}
