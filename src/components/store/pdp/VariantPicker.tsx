"use client";

import type { CSSProperties } from "react";

import { Price } from "@/components/ui";
import { cn } from "@/lib/cn";

import { usePurchase } from "./PurchaseProvider";
import { optionValueStates, pickVariant, selectedValueName } from "./product-model";

/**
 * Price (of the chosen variant, with MRP and "incl. of all taxes") and the option buttons. Each value is a
 * toggle button with its name always in text; swatches pass their colour through a CSS custom property.
 * Values with no variant at all are disabled; values whose exact combination is missing still work and
 * move the other option to the nearest variant.
 */
export function VariantPicker() {
  const { model, variant, variantId, setVariantId, stock } = usePurchase();
  if (!variant) return null;
  const groups = optionValueStates(model, variantId);

  return (
    <div className="flex flex-col gap-5">
      <Price
        size="lg"
        pricePaise={variant.pricePaise}
        mrpPaise={variant.mrpPaise}
        inclusiveOfTaxes
        showDiscount
      />
      <span className="sr-only" data-testid="selected-variant">
        {variant.title}
      </span>
      {groups.map(({ option, values }) => (
        <fieldset key={option.id} className="flex flex-col gap-2" data-testid={`option-${option.name}`}>
          <legend className="mb-2 text-base font-semibold text-ink">
            {option.name}
            <span className="font-normal text-ink-muted">: {selectedValueName(model, variantId, option.id)}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {values.map((v) => {
              const target = v.variantId ? stock?.get(v.variantId) : undefined;
              const soldOut = target ? !target.inStock : false;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={v.selected}
                  aria-disabled={v.disabled || undefined}
                  data-testid="option-value"
                  data-sold-out={soldOut || undefined}
                  onClick={() => {
                    if (v.disabled || v.selected) return;
                    const next = pickVariant(model, variantId, option.id, v.id);
                    if (next) setVariantId(next.id);
                  }}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-button border-token px-3.5 text-base font-semibold",
                    "transition-[background-color,box-shadow,transform] ease-vibe",
                    v.selected ? "bg-accent text-on-accent shadow-button" : "bg-surface text-ink hover:bg-surface-2",
                    v.disabled && "cursor-not-allowed opacity-40 line-through",
                    soldOut && !v.selected && "text-ink-muted",
                  )}
                >
                  {v.swatchHex ? (
                    <span
                      aria-hidden="true"
                      style={{ "--swatch": v.swatchHex } as CSSProperties}
                      className="size-5 flex-none rounded-full border border-ink/40 bg-(--swatch)"
                    />
                  ) : null}
                  <span className={cn(soldOut && "line-through decoration-1")}>{v.value}</span>
                  {soldOut ? <span className="sr-only"> (sold out)</span> : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
