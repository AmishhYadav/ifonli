import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/money";

export interface AmountBreakdownProps {
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  /** Shown only when above 0 (cash on delivery orders). */
  codFeePaise: number;
  totalPaise: number;
  /** GST already inside the total: "Includes ₹X GST". */
  taxIncludedPaise: number;
  /** Set while the shipping amount is still a placeholder (no pincode yet). */
  shippingNote?: string;
  className?: string;
}

const row = "flex items-baseline justify-between gap-4";

/** Every charge on its own line, then the total payable (plan 3: nothing hidden, nothing added at the end). */
export function AmountBreakdown({
  subtotalPaise,
  discountPaise,
  shippingPaise,
  codFeePaise,
  totalPaise,
  taxIncludedPaise,
  shippingNote,
  className,
}: AmountBreakdownProps) {
  return (
    <div className={cn("flex flex-col gap-2 text-base", className)} data-testid="amounts">
      <dl className="flex flex-col gap-2">
        <div className={row}>
          <dt className="text-ink-muted">Subtotal</dt>
          <dd className="tabular-nums" data-testid="amount-subtotal">
            {formatINR(subtotalPaise)}
          </dd>
        </div>
        {discountPaise > 0 ? (
          <div className={row}>
            <dt className="text-ink-muted">Discount</dt>
            <dd className="text-success tabular-nums" data-testid="amount-discount">
              -{formatINR(discountPaise)}
            </dd>
          </div>
        ) : null}
        <div className={row}>
          <dt className="text-ink-muted">Shipping</dt>
          <dd className="tabular-nums" data-testid="amount-shipping">
            {shippingPaise === 0 ? "Free" : formatINR(shippingPaise)}
          </dd>
        </div>
        {codFeePaise > 0 ? (
          <div className={row}>
            <dt className="text-ink-muted">Cash on delivery fee</dt>
            <dd className="tabular-nums" data-testid="amount-cod-fee">
              {formatINR(codFeePaise)}
            </dd>
          </div>
        ) : null}
        <div className={cn(row, "mt-1 border-t border-hairline pt-3")}>
          <dt className="text-lg font-bold">Total payable</dt>
          <dd className="text-xl font-bold tabular-nums" data-testid="amount-total">
            {formatINR(totalPaise)}
          </dd>
        </div>
      </dl>
      {shippingNote ? <p className="text-sm text-ink-muted">{shippingNote}</p> : null}
      <p className="text-sm text-ink-muted" data-testid="amount-gst">
        Includes {formatINR(taxIncludedPaise)} GST
      </p>
    </div>
  );
}
