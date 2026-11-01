import Image from "next/image";

import { Icon } from "@/components/ui/Icon";
import { formatINR } from "@/lib/money";

export interface OrderLine {
  key: string;
  name: string;
  /** "Default" and empty are not shown. */
  variantTitle?: string | null;
  qty: number;
  /** After the line's share of any discount. */
  lineTotalPaise: number;
  imageUrl: string | null;
}

/** Items in an order or the checkout review: thumbnail, name, quantity and line total. */
export function OrderLines({
  lines,
  className,
}: {
  lines: readonly OrderLine[];
  className?: string;
}) {
  return (
    <ul className={className ?? "flex flex-col gap-4"} data-testid="order-lines">
      {lines.map((line) => (
        <li key={line.key} className="flex items-start gap-3">
          <span className="relative size-16 flex-none overflow-hidden rounded-card border border-border bg-surface-2">
            {line.imageUrl ? (
              <Image src={line.imageUrl} alt="" fill sizes="64px" className="object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-ink-muted">
                <Icon name="package" className="size-6" />
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base leading-snug font-semibold break-words">{line.name}</p>
            {line.variantTitle && line.variantTitle !== "Default" ? (
              <p className="text-sm text-ink-muted">{line.variantTitle}</p>
            ) : null}
            <p className="text-sm text-ink-muted">Qty {line.qty}</p>
          </div>
          <p className="flex-none text-base font-semibold tabular-nums">
            {formatINR(line.lineTotalPaise)}
          </p>
        </li>
      ))}
    </ul>
  );
}
