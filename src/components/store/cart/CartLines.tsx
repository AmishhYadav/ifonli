"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";

import { IconButton, Price, QuantityStepper } from "@/components/ui";
import type { CartView, CartViewLine } from "@/features/cart/types";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/cn";

interface CartLinesProps {
  cart: CartView;
  onQuantity: (variantId: string, qty: number) => void;
  onRemove: (variantId: string, after?: () => void) => void;
  /** `drawer` is a compact column, `page` gives the line more room. */
  layout: "drawer" | "page";
}

function LineImage({ line, size }: { line: CartViewLine; size: number }) {
  return (
    <span
      className="relative block flex-none overflow-hidden rounded-input border border-border bg-surface-2"
      style={{ width: size, height: size }}
    >
      {line.image?.url ? (
        <Image
          src={line.image.url}
          alt=""
          width={size * 2}
          height={size * 2}
          sizes={`${size}px`}
          className="size-full object-contain p-1.5"
        />
      ) : null}
    </span>
  );
}

/**
 * The cart's lines (image, name, variant, unit price, quantity stepper, remove). Quantity changes are
 * optimistic through the parent; a removed line hands focus to the list so keyboard users are not dropped
 * back at the top of the page.
 */
export function CartLines({ cart, onQuantity, onRemove, layout }: CartLinesProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const size = layout === "page" ? 96 : 72;

  return (
    <ul
      ref={listRef}
      tabIndex={-1}
      aria-label="Items in your cart"
      data-testid="cart-lines"
      className="flex flex-col divide-y divide-border outline-none"
    >
      {cart.lines.map((line) => {
        const showVariant = line.variantTitle && line.variantTitle !== "Default";
        return (
          <li
            key={line.lineId}
            data-testid="cart-line"
            data-variant-id={line.variantId}
            className={cn("flex gap-3 py-4 first:pt-0 last:pb-0", layout === "page" && "gap-4 sm:py-5")}
          >
            <Link href={`/products/${line.productSlug}`} aria-hidden="true" tabIndex={-1} className="flex-none">
              <LineImage line={line} size={size} />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/products/${line.productSlug}`}
                    className="block text-base leading-snug font-semibold text-ink underline-offset-4 hover:underline"
                    data-testid="cart-line-name"
                  >
                    {line.productName}
                  </Link>
                  {showVariant ? <p className="text-sm text-ink-muted">{line.variantTitle}</p> : null}
                </div>
                <p className="flex-none text-base font-bold tabular-nums text-ink" data-testid="cart-line-total">
                  <span className="sr-only">Line total </span>
                  {formatINR(line.lineSubtotalPaise)}
                </p>
              </div>
              <Price pricePaise={line.unitPricePaise} mrpPaise={line.mrpPaise} size="sm" />
              {line.lowStock ? (
                <p className="text-sm text-warning">
                  {line.available <= 0 ? "None left" : `Only ${line.available} left`}
                </p>
              ) : null}
              <div className="mt-1 flex items-center justify-between gap-3">
                <QuantityStepper
                  label={`Quantity of ${line.productName}${showVariant ? `, ${line.variantTitle}` : ""}`}
                  value={line.qty}
                  min={1}
                  max={Math.max(1, line.maxQty)}
                  onChange={(qty) => onQuantity(line.variantId, qty)}
                />
                <IconButton
                  icon="trash"
                  size="sm"
                  label={`Remove ${line.productName}${showVariant ? `, ${line.variantTitle}` : ""} from cart`}
                  onClick={() => onRemove(line.variantId, () => listRef.current?.focus())}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
