"use client";

import { useEffect, useState, useTransition } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { useToast } from "@/components/ui/Toast";
import { addItem, getCartState, setCartOpen } from "@/components/store/cart/cart-store";
import { useVibe } from "@/features/vibe/useVibe";
import { track } from "@/lib/analytics/client";
import { addedQuantity } from "@/lib/analytics/cart-events";
import { COPY } from "@/features/vibe/copy";
import type { LiveVariantAvailability } from "@/server/services/queries/types";

import { usePurchase } from "./PurchaseProvider";
import { clampQty, stockStatus } from "./product-model";

/**
 * Live stock line, quantity stepper and the Add to cart button for the chosen variant. Rendered from the
 * uncached stock hole, so every number here is current. On mobile the action row sticks to the bottom of
 * the screen while the product details are in view (it is a direct child of the info column).
 */
export function StockControls({ availability }: { availability: LiveVariantAvailability[] }) {
  const { model, variant, setStock } = usePurchase();
  const { toast } = useToast();
  const { vibe } = useVibe();
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setStock(new Map(availability.map((a) => [a.variantId, a])));
  }, [availability, setStock]);

  const live = variant ? availability.find((a) => a.variantId === variant.id) : undefined;
  const status = stockStatus(live);
  const max = live?.maxOrderable ?? 0;
  const shownQty = clampQty(qty, max);
  const canBuy = Boolean(variant && live?.inStock && max > 0);

  const variantLabel = variant && variant.title && variant.title !== "Default" ? variant.title : null;

  const onAdd = () => {
    if (!variant || !canBuy) return;
    setMessage(null);
    startTransition(async () => {
      // The line's quantity before the call (null when this page has not loaded the cart yet), so the event
      // can report what the cart really took: stock and per-line caps may lower the requested quantity.
      const known = getCartState().cart;
      const before = known ? (known.lines.find((l) => l.variantId === variant.id)?.qty ?? 0) : null;
      const result = await addItem(variant.id, shownQty);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error.message });
        return;
      }
      const after = result.data.cart.lines.find((l) => l.variantId === variant.id)?.qty ?? 0;
      const added = addedQuantity(before, after, shownQty);
      if (added > 0) track("add_to_cart", { productId: model.productId, value: added });
      const notice = result.data.notices.find((n) => !n.variantId || n.variantId === variant.id);
      if (notice) setMessage({ tone: "info", text: notice.message });
      toast({
        title: COPY[vibe]["toast.addedToCart"],
        description: notice?.message ?? `${model.name}${variantLabel ? ` (${variantLabel})` : ""}`,
        tone: "success",
        action: { label: "View cart", onClick: () => setCartOpen(true) },
      });
    });
  };

  return (
    <>
      <p
        aria-live="polite"
        data-testid="stock-status"
        data-stock={status?.kind}
        className="flex items-center gap-2 text-base font-semibold"
      >
        {status ? (
          <>
            {status.kind === "sold_out" ? (
              <Badge tone="neutral" className="border-token bg-surface">
                <Icon name="alert-circle" className="size-3.5" />
                {status.label}
              </Badge>
            ) : status.kind === "low" ? (
              <Badge tone="warning">
                <Icon name="alert-circle" className="size-3.5" />
                {status.label}
              </Badge>
            ) : (
              <Badge tone="success">
                <Icon name="check" className="size-3.5" />
                {status.label}
              </Badge>
            )}
          </>
        ) : null}
      </p>

      <div
        className={
          "flex items-center gap-3 max-md:sticky max-md:bottom-0 max-md:z-30 max-md:-mx-4 max-md:border-t max-md:border-border " +
          "max-md:bg-bg max-md:px-4 max-md:pt-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        }
        data-testid="add-to-cart-bar"
      >
        {canBuy ? (
          <QuantityStepper
            label="Quantity"
            value={shownQty}
            min={1}
            max={max}
            onChange={(n) => {
              setQty(n);
              setMessage(null);
            }}
          />
        ) : null}
        <Button
          size="lg"
          className="min-w-0 flex-1"
          disabled={!canBuy}
          loading={pending}
          iconStart={canBuy ? "bag" : undefined}
          onClick={onAdd}
          data-testid="add-to-cart"
        >
          {canBuy ? "Add to cart" : "Sold out"}
        </Button>
      </div>

      <div role="status" aria-live="polite" data-testid="add-message" className="empty:hidden">
        {message ? (
          <p
            className={
              message.tone === "error"
                ? "flex items-start gap-2 text-sm font-semibold text-danger"
                : "flex items-start gap-2 text-sm text-ink"
            }
          >
            <Icon name={message.tone === "error" ? "alert-circle" : "info"} className="mt-0.5 size-4 flex-none" />
            {message.text}
          </p>
        ) : null}
      </div>
    </>
  );
}

/** What the stock hole shows while the live numbers load (the page's static shell). */
export function StockFallback() {
  return (
    <>
      <p aria-busy="true" className="min-h-7 text-base text-ink-muted" data-testid="stock-loading">
        Checking stock...
      </p>
      <div className="flex items-center gap-3 max-md:sticky max-md:bottom-0 max-md:z-30 max-md:-mx-4 max-md:border-t max-md:border-border max-md:bg-bg max-md:px-4 max-md:py-3">
        <Button size="lg" className="min-w-0 flex-1" disabled>
          Add to cart
        </Button>
      </div>
    </>
  );
}
