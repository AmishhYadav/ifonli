/**
 * Pricing engine (plan 7.1). Deterministic and pure; the same function runs in cart, checkout and
 * order creation. All amounts are integer paise and every price is GST-inclusive.
 */

import { formatINR } from "@/lib/money";

import { couponDiscountPaise, type AppliedCoupon } from "./coupons";
import { splitGst, taxIncludedIn, type GstSplit } from "./tax";
import type { CartLine, PaymentMethod, Zone } from "./types";

export type PricingErrorCode =
  | "invalid_qty"
  | "invalid_price"
  | "invalid_mrp"
  | "price_exceeds_mrp"
  | "invalid_gst_rate"
  | "duplicate_line"
  | "invalid_config";

export class PricingError extends Error {
  override name = "PricingError";
  constructor(
    readonly code: PricingErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ShippingTaxRule = { kind: "dominant_line_rate" } | { kind: "fixed"; rateBp: number };

export interface PriceInput {
  lines: readonly CartLine[];
  coupon: AppliedCoupon | null;
  shipping: {
    flatFeePaise: number;
    /** null = free shipping is never offered. */
    freeThresholdPaise: number | null;
    zoneFeeOverridesPaise?: Partial<Record<Zone, number>>;
    /** 6-digit delivery pincodes that always ship free, whatever the order value. */
    freePincodes?: readonly string[];
  };
  /** 6-digit delivery pincode once known (checkout); null / omitted = not known yet. */
  pincode?: string | null;
  zone: Zone | null;
  paymentMethod: PaymentMethod | null;
  cod: { feePaise: number };
  shippingTaxRule: ShippingTaxRule;
  sellerStateCode: string;
  buyerStateCode: string | null;
}

export interface PricedLine extends CartLine {
  lineSubtotalPaise: number;
  discountAllocPaise: number;
  lineTotalPaise: number;
  /** Value excluding GST, computed on `lineTotalPaise`. */
  taxablePaise: number;
  /** GST contained in `lineTotalPaise`. */
  taxPaise: number;
}

export interface PriceMessage {
  code:
    | "coupon_min_subtotal_unmet"
    | "coupon_no_eligible_items"
    | "free_shipping_coupon"
    | "free_shipping_pincode"
    | "free_shipping_progress"
    | "free_shipping_unlocked";
  text: string;
}

export interface PriceResult {
  lines: PricedLine[];
  subtotalPaise: number;
  discountPaise: number;
  /** Shipping actually charged (after threshold / free-shipping coupon). */
  shippingPaise: number;
  /** Shipping waived by a free_shipping coupon (0 for other coupons or when already free). */
  shippingDiscountPaise: number;
  codFeePaise: number;
  /** subtotal - discount + shipping + codFee. */
  totalPaise: number;
  /** GST included in the total: lines + shipping + COD fee. Never added on top. */
  taxIncludedPaise: number;
  shippingTaxPaise: number;
  codFeeTaxPaise: number;
  /** Rate applied to shipping and the COD fee; null for an empty cart. */
  shippingTaxRateBp: number | null;
  /**
   * CGST/SGST/IGST totals (sum of the split of every taxed item: each line, shipping, COD fee).
   * `cgst + sgst + igst === taxIncludedPaise`. null when the buyer state is not known yet.
   */
  gst: GstSplit | null;
  /** Extra spend (after discount) still needed for free shipping; 0 once free (threshold, coupon or free pincode); null if not offered / empty cart. */
  freeShippingRemainingPaise: number | null;
  messages: PriceMessage[];
  /** sum((mrp - unit price) * qty): saving vs MRP from the selling price itself, excluding any coupon. */
  savingsVsMrpPaise: number;
  /** Coupon actually applied (null if none / dropped as unmet). */
  appliedCouponCode: string | null;
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function validateInput(input: PriceInput): void {
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (seen.has(l.lineId)) {
      throw new PricingError("duplicate_line", `Duplicate lineId "${l.lineId}"`);
    }
    seen.add(l.lineId);
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0) {
      throw new PricingError(
        "invalid_qty",
        `Line ${l.lineId}: qty must be a positive integer, got ${l.qty}`,
      );
    }
    if (!isNonNegInt(l.unitPricePaise)) {
      throw new PricingError(
        "invalid_price",
        `Line ${l.lineId}: unit price must be a non-negative integer`,
      );
    }
    if (!isNonNegInt(l.mrpPaise)) {
      throw new PricingError("invalid_mrp", `Line ${l.lineId}: MRP must be a non-negative integer`);
    }
    if (l.unitPricePaise > l.mrpPaise) {
      throw new PricingError("price_exceeds_mrp", `Line ${l.lineId}: unit price exceeds MRP`);
    }
    if (!isNonNegInt(l.gstRateBp) || l.gstRateBp > 10000) {
      throw new PricingError(
        "invalid_gst_rate",
        `Line ${l.lineId}: gstRateBp must be an integer in 0..10000`,
      );
    }
    if (
      !Number.isSafeInteger(l.unitPricePaise * l.qty) ||
      !Number.isSafeInteger(l.mrpPaise * l.qty)
    ) {
      throw new PricingError("invalid_price", `Line ${l.lineId}: line amount is too large`);
    }
  }
  const { shipping, cod, shippingTaxRule } = input;
  if (!isNonNegInt(shipping.flatFeePaise)) {
    throw new PricingError(
      "invalid_config",
      "shipping.flatFeePaise must be a non-negative integer",
    );
  }
  if (shipping.freeThresholdPaise !== null && !isNonNegInt(shipping.freeThresholdPaise)) {
    throw new PricingError(
      "invalid_config",
      "shipping.freeThresholdPaise must be null or a non-negative integer",
    );
  }
  for (const [zone, fee] of Object.entries(shipping.zoneFeeOverridesPaise ?? {})) {
    if (!isNonNegInt(fee)) {
      throw new PricingError(
        "invalid_config",
        `Zone override for "${zone}" must be a non-negative integer`,
      );
    }
  }
  if (!isNonNegInt(cod.feePaise)) {
    throw new PricingError("invalid_config", "cod.feePaise must be a non-negative integer");
  }
  if (
    shippingTaxRule.kind === "fixed" &&
    (!isNonNegInt(shippingTaxRule.rateBp) || shippingTaxRule.rateBp > 10000)
  ) {
    throw new PricingError(
      "invalid_config",
      "shippingTaxRule.rateBp must be an integer in 0..10000",
    );
  }
}

/**
 * Spread `discount` across items pro-rata by subtotal.
 * Each share is floored; the leftover paise go to the largest item (first on ties). If an item has
 * no room left (share would exceed its own subtotal), the leftover spills to the next largest.
 * The allocations always sum to exactly `discount` (for `discount <= sum(subtotals)`).
 */
export function allocateDiscount(
  discount: number,
  items: readonly { id: string; subtotalPaise: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  const total = items.reduce((s, i) => s + i.subtotalPaise, 0);
  if (discount < 0 || discount > total) {
    throw new PricingError("invalid_config", "discount must be within 0..eligible subtotal");
  }
  let allocated = 0;
  for (const i of items) {
    const share =
      total === 0 ? 0 : Number((BigInt(discount) * BigInt(i.subtotalPaise)) / BigInt(total));
    out.set(i.id, share);
    allocated += share;
  }
  let remainder = discount - allocated;
  const order = items
    .map((i, index) => ({ ...i, index }))
    .sort((a, b) => b.subtotalPaise - a.subtotalPaise || a.index - b.index);
  for (const i of order) {
    if (remainder === 0) {
      break;
    }
    const current = out.get(i.id) ?? 0;
    const give = Math.min(remainder, i.subtotalPaise - current);
    out.set(i.id, current + give);
    remainder -= give;
  }
  return out;
}

/** Rate with the largest sum of line totals; ties go to the higher rate. */
function dominantRateBp(lines: readonly PricedLine[]): number {
  const sums = new Map<number, number>();
  for (const l of lines) {
    sums.set(l.gstRateBp, (sums.get(l.gstRateBp) ?? 0) + l.lineTotalPaise);
  }
  let best = 0;
  let bestSum = -1;
  for (const [rate, sum] of sums) {
    if (sum > bestSum || (sum === bestSum && rate > best)) {
      best = rate;
      bestSum = sum;
    }
  }
  return best;
}

export function priceCart(input: PriceInput): PriceResult {
  validateInput(input);

  const messages: PriceMessage[] = [];
  const base = input.lines.map((l) => ({ ...l, lineSubtotalPaise: l.unitPricePaise * l.qty }));
  const subtotalPaise = base.reduce((s, l) => s + l.lineSubtotalPaise, 0);
  const savingsVsMrpPaise = input.lines.reduce(
    (s, l) => s + (l.mrpPaise - l.unitPricePaise) * l.qty,
    0,
  );

  if (base.length === 0) {
    return {
      lines: [],
      subtotalPaise: 0,
      discountPaise: 0,
      shippingPaise: 0,
      shippingDiscountPaise: 0,
      codFeePaise: 0,
      totalPaise: 0,
      taxIncludedPaise: 0,
      shippingTaxPaise: 0,
      codFeeTaxPaise: 0,
      shippingTaxRateBp: null,
      gst: input.buyerStateCode === null ? null : { cgst: 0, sgst: 0, igst: 0 },
      freeShippingRemainingPaise: null,
      messages,
      savingsVsMrpPaise: 0,
      appliedCouponCode: null,
    };
  }

  // --- Coupon ---------------------------------------------------------------------------------
  let discountPaise = 0;
  let freeShippingCoupon = false;
  let appliedCouponCode: string | null = null;
  let allocations = new Map<string, number>();
  const coupon = input.coupon;
  if (coupon) {
    if (coupon.minSubtotalPaise !== null && subtotalPaise < coupon.minSubtotalPaise) {
      messages.push({
        code: "coupon_min_subtotal_unmet",
        text: `Add ${formatINR(coupon.minSubtotalPaise - subtotalPaise)} more to use ${coupon.code}`,
      });
    } else {
      const ids = new Set(coupon.eligibleLineIds);
      const eligible = base.filter((l) => ids.has(l.lineId));
      if (eligible.length === 0) {
        messages.push({
          code: "coupon_no_eligible_items",
          text: `${coupon.code} doesn't apply to the items in your bag.`,
        });
      } else if (coupon.kind === "free_shipping") {
        freeShippingCoupon = true;
        appliedCouponCode = coupon.code;
      } else {
        const eligibleSubtotal = eligible.reduce((s, l) => s + l.lineSubtotalPaise, 0);
        discountPaise = couponDiscountPaise(
          coupon.kind,
          coupon.value,
          coupon.maxDiscountPaise,
          eligibleSubtotal,
        );
        allocations = allocateDiscount(
          discountPaise,
          eligible.map((l) => ({ id: l.lineId, subtotalPaise: l.lineSubtotalPaise })),
        );
        appliedCouponCode = coupon.code;
      }
    }
  }

  // --- Lines & tax ----------------------------------------------------------------------------
  const lines: PricedLine[] = base.map((l) => {
    const discountAllocPaise = allocations.get(l.lineId) ?? 0;
    const lineTotalPaise = l.lineSubtotalPaise - discountAllocPaise;
    const { taxablePaise, taxPaise } = taxIncludedIn(lineTotalPaise, l.gstRateBp);
    return { ...l, discountAllocPaise, lineTotalPaise, taxablePaise, taxPaise };
  });

  // --- Shipping -------------------------------------------------------------------------------
  const afterDiscount = subtotalPaise - discountPaise;
  const zoneFee =
    input.zone === null ? undefined : input.shipping.zoneFeeOverridesPaise?.[input.zone];
  const feePaise = zoneFee ?? input.shipping.flatFeePaise;
  const threshold = input.shipping.freeThresholdPaise;
  const freeByThreshold = threshold !== null && afterDiscount >= threshold;
  const freeByPincode =
    input.pincode != null && (input.shipping.freePincodes ?? []).includes(input.pincode);
  const chargeable = freeByThreshold || freeByPincode ? 0 : feePaise;
  const shippingDiscountPaise = freeShippingCoupon ? chargeable : 0;
  const shippingPaise = chargeable - shippingDiscountPaise;

  let freeShippingRemainingPaise: number | null = null;
  if (threshold !== null) {
    freeShippingRemainingPaise =
      freeShippingCoupon || freeByPincode ? 0 : Math.max(0, threshold - afterDiscount);
  } else if (freeByPincode) {
    freeShippingRemainingPaise = 0;
  }

  if (freeShippingCoupon && shippingDiscountPaise > 0) {
    messages.push({
      code: "free_shipping_coupon",
      text: `Free shipping applied with ${coupon?.code ?? ""}`.trim(),
    });
  } else if (freeByPincode && feePaise > 0) {
    messages.push({ code: "free_shipping_pincode", text: "Free shipping to your pincode." });
  } else if (freeByThreshold && feePaise > 0) {
    messages.push({ code: "free_shipping_unlocked", text: "You've unlocked free shipping." });
  } else if (
    !freeShippingCoupon &&
    threshold !== null &&
    freeShippingRemainingPaise !== null &&
    freeShippingRemainingPaise > 0 &&
    feePaise > 0
  ) {
    messages.push({
      code: "free_shipping_progress",
      text: `Add ${formatINR(freeShippingRemainingPaise)} more for free shipping`,
    });
  }

  // --- COD fee --------------------------------------------------------------------------------
  const codFeePaise = input.paymentMethod === "cod" ? input.cod.feePaise : 0;

  // --- Tax on shipping & COD fee --------------------------------------------------------------
  const shippingTaxRateBp =
    input.shippingTaxRule.kind === "fixed" ? input.shippingTaxRule.rateBp : dominantRateBp(lines);
  const shippingTax = taxIncludedIn(shippingPaise, shippingTaxRateBp);
  const codTax = taxIncludedIn(codFeePaise, shippingTaxRateBp);

  const taxIncludedPaise =
    lines.reduce((s, l) => s + l.taxPaise, 0) + shippingTax.taxPaise + codTax.taxPaise;

  let gst: GstSplit | null = null;
  if (input.buyerStateCode !== null) {
    const parties = {
      sellerStateCode: input.sellerStateCode,
      buyerStateCode: input.buyerStateCode,
    };
    gst = { cgst: 0, sgst: 0, igst: 0 };
    for (const tax of [...lines.map((l) => l.taxPaise), shippingTax.taxPaise, codTax.taxPaise]) {
      const part = splitGst(tax, parties);
      gst.cgst += part.cgst;
      gst.sgst += part.sgst;
      gst.igst += part.igst;
    }
  }

  return {
    lines,
    subtotalPaise,
    discountPaise,
    shippingPaise,
    shippingDiscountPaise,
    codFeePaise,
    totalPaise: subtotalPaise - discountPaise + shippingPaise + codFeePaise,
    taxIncludedPaise,
    shippingTaxPaise: shippingTax.taxPaise,
    codFeeTaxPaise: codTax.taxPaise,
    shippingTaxRateBp,
    gst,
    freeShippingRemainingPaise,
    messages,
    savingsVsMrpPaise,
    appliedCouponCode,
  };
}
