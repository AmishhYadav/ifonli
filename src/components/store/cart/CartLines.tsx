"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";

import { IconButton } from "@/components/ui/Button";
import { Price } from "@/components/ui/Price";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
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
      className="art-none relative block flex-none overflow-hidden rounded-input"
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
      aria-label="Items in your bag"
      data-testid="cart-lines"
      className={cn(
        "flex flex-col divide-y divide-hairline outline-none",
        layout === "page" && "rounded-card bg-surface px-4 shadow-card sm:px-6",
      )}
    >
      {cart.lines.map((line) => {
        if (line.isDiyChain) {
          return (
            <li
              key={line.lineId}
              data-testid="cart-line"
              data-diy-chain=""
              data-variant-id={line.variantId}
              className={cn("flex items-center gap-3 py-4 first:pt-0 last:pb-0", layout === "page" && "gap-4 py-5 first:pt-5 last:pb-5 sm:py-6 sm:first:pt-6 sm:last:pb-6")}
            >
              <LineImage line={line} size={size} />
              <div className="min-w-0 flex-1">
                <p className="text-base leading-snug font-semibold text-ink">
                  {line.productName}
                  {line.qty > 1 ? <span className="font-normal text-ink-muted"> × {line.qty}</span> : null}
                </p>
                <p className="text-sm text-ink-muted">Included with your DIY pack</p>
              </div>
              <p className="flex-none text-base font-bold text-ink" data-testid="cart-line-total">
                Free
              </p>
            </li>
          );
        }
        const showVariant = line.variantTitle && line.variantTitle !== "Default";
        return (
          <li
            key={line.lineId}
            data-testid="cart-line"
            data-variant-id={line.variantId}
            className={cn("flex gap-3 py-4 first:pt-0 last:pb-0", layout === "page" && "gap-4 py-5 first:pt-5 last:pb-5 sm:py-6 sm:first:pt-6 sm:last:pb-6")}
          >
            <Link href={`/products/${line.productSlug}`} aria-hidden="true" tabIndex={-1} className="flex-none">
              <LineImage line={line} size={size} />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/products/${line.productSlug}`}
                    className="-my-3 block py-3 text-base leading-snug font-semibold text-ink underline-offset-4 hover:underline"
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
              {/* With one unit the line total beside the name already is the price; show the unit price only when it adds something. */}
              {line.qty > 1 || (line.mrpPaise > line.unitPricePaise) ? (
                <Price pricePaise={line.unitPricePaise} mrpPaise={line.mrpPaise} size="sm" />
              ) : null}
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
                  label={`Remove ${line.productName}${showVariant ? `, ${line.variantTitle}` : ""} from bag`}
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
