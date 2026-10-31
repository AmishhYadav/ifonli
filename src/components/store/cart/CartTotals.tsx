import { formatINR } from "@/lib/money";
import type { CartView } from "@/features/cart/types";
import { cn } from "@/lib/cn";

import { shippingNote, shippingValue } from "./cart-math";

/**
 * Subtotal, discount (only when one applies), shipping estimate, total and "Includes GST". Amounts come
 * straight from the server's cart view; nothing is added up here. No client hooks, so the page can render
 * it on either side.
 */
export function CartTotals({ cart, className }: { cart: CartView; className?: string }) {
  const { pricing } = cart;
  const hasLines = cart.lines.length > 0;
  const note = hasLines ? shippingNote(pricing) : null;
  const row = "flex items-baseline justify-between gap-4 text-base";

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="cart-totals">
      <div className={row}>
        <span className="text-ink-muted">
          Subtotal ({cart.itemCount} {cart.itemCount === 1 ? "item" : "items"})
        </span>
        <span className="font-semibold tabular-nums" data-testid="cart-subtotal">
          {formatINR(pricing.subtotalPaise)}
        </span>
      </div>
      {pricing.discountPaise > 0 ? (
        <div className={row}>
          <span className="text-ink-muted">Discount{cart.coupon?.applied ? ` (${cart.coupon.code})` : ""}</span>
          <span className="font-semibold text-success tabular-nums" data-testid="cart-discount">
            -{formatINR(pricing.discountPaise)}
          </span>
        </div>
      ) : null}
      <div>
        <div className={row}>
          <span className="text-ink-muted">Shipping (estimate)</span>
          <span className="font-semibold tabular-nums" data-testid="cart-shipping">
            {shippingValue(pricing, hasLines)}
          </span>
        </div>
        {note ? <p className="mt-0.5 text-sm text-ink-muted">{note}</p> : null}
      </div>
      <div className="mt-1 border-t border-border pt-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-lg font-bold">Total</span>
          <span className="text-xl font-bold tabular-nums" data-testid="cart-total">
            {formatINR(pricing.totalPaise)}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-ink-muted" data-testid="cart-gst">
          Includes {formatINR(pricing.taxIncludedPaise)} GST. Final shipping is confirmed at checkout.
        </p>
        {pricing.savingsVsMrpPaise > 0 ? (
          <p className="mt-0.5 text-sm text-success">You save {formatINR(pricing.savingsVsMrpPaise)} on MRP.</p>
        ) : null}
      </div>
    </div>
  );
}
