import { formatINR } from "@/lib/money";
import { cn } from "@/lib/cn";

export interface PriceProps {
  /** Selling price, integer paise. */
  pricePaise: number;
  /** MRP, integer paise. Struck through ONLY when it is above the price; otherwise ignored. */
  mrpPaise?: number | null;
  /** Prefix "From" (variable price: the cheapest variant). */
  from?: boolean;
  /**
   * Show "incl. of all taxes" under the price. When the price IS the MRP (no strike-through to carry the
   * word), the line reads "MRP incl. of all taxes" so the legal wording (Legal Metrology) is always on screen.
   */
  inclusiveOfTaxes?: boolean;
  /** Show "N% off", computed from the real MRP (only when there is a real discount). */
  showDiscount?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizes = {
  sm: { price: "text-base", mrp: "text-sm" },
  md: { price: "text-lg", mrp: "text-sm" },
  lg: { price: "text-2xl", mrp: "text-base" },
} as const;

/** Whole-number percent off, or 0 when there is no real discount. */
export function discountPercent(pricePaise: number, mrpPaise: number | null | undefined): number {
  if (!mrpPaise || mrpPaise <= pricePaise || mrpPaise <= 0) return 0;
  return Math.floor(((mrpPaise - pricePaise) / mrpPaise) * 100);
}

export function Price({
  pricePaise,
  mrpPaise,
  from = false,
  inclusiveOfTaxes = false,
  showDiscount = false,
  size = "md",
  className,
}: PriceProps) {
  const hasDiscount = mrpPaise != null && mrpPaise > pricePaise;
  const percent = showDiscount ? discountPercent(pricePaise, mrpPaise) : 0;
  const s = sizes[size];

  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {from ? <span className={cn("text-ink-muted", s.mrp)}>From</span> : null}
        <span className={cn("font-bold tabular-nums text-price", s.price)}>{formatINR(pricePaise)}</span>
        {hasDiscount ? (
          <>
            <s className={cn("tabular-nums text-ink-muted", s.mrp)}>
              <span className="sr-only">MRP </span>
              {formatINR(mrpPaise)}
            </s>
            {percent > 0 ? (
              <span className={cn("font-semibold text-sale", s.mrp)}>{percent}% off</span>
            ) : null}
          </>
        ) : null}
      </span>
      {inclusiveOfTaxes ? (
        <span className="text-xs text-ink-muted">
          {mrpPaise != null && mrpPaise === pricePaise ? "MRP incl. of all taxes" : "incl. of all taxes"}
        </span>
      ) : null}
    </span>
  );
}
