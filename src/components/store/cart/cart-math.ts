import { formatINR } from "@/lib/money";
import type { CartView, CartViewPricing } from "@/features/cart/types";

/**
 * Pure cart helpers shared by the drawer and the cart page: the optimistic reducer used with
 * `useOptimistic` (the server result replaces it as soon as the Server Action returns) and the
 * wording of the shipping / GST rows.
 */

export type CartOptimisticAction =
  | { type: "qty"; variantId: string; qty: number }
  | { type: "remove"; variantId: string };

/**
 * What the cart will probably look like after the change, computed locally so the stepper and totals
 * react at once. Discount, shipping and the tax split are carried over (GST is scaled with the total);
 * the server's own numbers replace all of it when the action returns.
 */
export function applyOptimistic(cart: CartView, action: CartOptimisticAction): CartView {
  const lines = cart.lines.flatMap((line) => {
    if (line.variantId !== action.variantId) return [line];
    const qty = action.type === "remove" ? 0 : action.qty;
    if (qty <= 0) return [];
    const lineSubtotalPaise = line.unitPricePaise * qty;
    return [
      {
        ...line,
        qty,
        lineSubtotalPaise,
        lineTotalPaise: Math.max(0, lineSubtotalPaise - line.discountAllocPaise),
      },
    ];
  });

  if (lines.length === 0) {
    return {
      ...cart,
      lines,
      itemCount: 0,
      canCheckout: false,
      pricing: {
        ...cart.pricing,
        subtotalPaise: 0,
        discountPaise: 0,
        shippingPaise: 0,
        totalPaise: 0,
        taxIncludedPaise: 0,
        savingsVsMrpPaise: 0,
      },
    };
  }

  const subtotalPaise = lines.reduce((sum, l) => sum + l.lineSubtotalPaise, 0);
  const discountPaise = Math.min(cart.pricing.discountPaise, subtotalPaise);
  const totalPaise = subtotalPaise - discountPaise + cart.pricing.shippingPaise;
  const oldTotal = cart.pricing.totalPaise;
  return {
    ...cart,
    lines,
    itemCount: lines.reduce((sum, l) => sum + l.qty, 0),
    pricing: {
      ...cart.pricing,
      subtotalPaise,
      discountPaise,
      totalPaise,
      taxIncludedPaise: oldTotal > 0 ? Math.round((cart.pricing.taxIncludedPaise * totalPaise) / oldTotal) : 0,
    },
  };
}

/** True when `pincode` (6 digits) is on the store's always-free-shipping list. */
export function isFreeShippingPincode(pricing: CartViewPricing, pincode: string | null | undefined): boolean {
  return !!pincode && pricing.freeShippingPincodes.includes(pincode);
}

/**
 * Client-side estimate once the delivery pincode is known: a free-shipping pincode zeroes the shipping fee
 * and the total drops with it (GST contained in the fee is not tracked here; the server quote replaces
 * this as soon as it arrives). Anything else is returned unchanged.
 */
export function withPincodeShipping(pricing: CartViewPricing, pincode: string | null | undefined): CartViewPricing {
  if (!isFreeShippingPincode(pricing, pincode)) return pricing;
  return {
    ...pricing,
    shippingPaise: 0,
    totalPaise: pricing.totalPaise - pricing.shippingPaise,
    freeShippingRemainingPaise: 0,
    messages: pricing.messages.filter((m) => !/more for free shipping/i.test(m)),
  };
}

/** Right-hand value of the shipping row. */
export function shippingValue(pricing: CartViewPricing, hasLines: boolean, pincode?: string | null): string {
  if (!hasLines) return "-";
  const p = withPincodeShipping(pricing, pincode);
  return p.shippingPaise === 0 ? "Free" : formatINR(p.shippingPaise);
}

/**
 * Plain-language shipping note under the row (drip-pricing rule: the estimate is visible before
 * checkout). Never urgency: just the threshold and the gap.
 */
export function shippingNote(pricing: CartViewPricing, pincode?: string | null): string | null {
  if (isFreeShippingPincode(pricing, pincode)) return "Free shipping to your pincode.";
  const { freeThresholdPaise, freeShippingRemainingPaise } = pricing;
  if (freeThresholdPaise === null) return null;
  if (freeShippingRemainingPaise === 0) return "You've unlocked free shipping.";
  if (freeShippingRemainingPaise !== null && freeShippingRemainingPaise > 0) {
    return `Free shipping above ${formatINR(freeThresholdPaise)}. Add ${formatINR(freeShippingRemainingPaise)} more.`;
  }
  return `Free shipping above ${formatINR(freeThresholdPaise)}.`;
}

/** Sentence for the polite live region after a change. */
export function summaryAnnouncement(cart: CartView): string {
  if (cart.lines.length === 0) return "Your bag is empty.";
  const n = cart.itemCount;
  return `Bag updated: ${n} ${n === 1 ? "item" : "items"}, total ${formatINR(cart.pricing.totalPaise)}.`;
}
