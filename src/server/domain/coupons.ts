/**
 * Coupon validation (plan 7.3). Pure: the caller loads the CouponRecord and the redemption counts.
 *
 * Design choices (documented in README):
 *  - Min subtotal compares the WHOLE cart subtotal (pre-discount, all lines), not the eligible subtotal.
 *  - `startsAt` is inclusive (valid at that instant); `endsAt` is inclusive (expired only after it).
 *  - A malformed record (percent outside 1..10000 bp, non-positive fixed value) is reported as `inactive`
 *    so a bad admin entry can never crash checkout or discount more than intended.
 *  - Re-applying the SAME code that is already on the order is not stacking.
 */

import { formatINR } from "@/lib/money";

import { formatIstDate } from "./ist";
import type { CartLine } from "./types";

export type CouponKind = "percent" | "fixed" | "free_shipping";

export interface CouponScope {
  vibes?: string[];
  types?: string[];
  products?: string[];
  excludeProducts?: string[];
}

export interface CouponRecord {
  id: string;
  code: string;
  kind: CouponKind;
  /** percent: basis points (1000 = 10%); fixed: paise; free_shipping: ignored. */
  value: number;
  startsAt: Date | null;
  endsAt: Date | null;
  minSubtotalPaise: number | null;
  maxDiscountPaise: number | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  scope: CouponScope;
  active: boolean;
}

export interface CouponContext {
  now: Date;
  lines: readonly CartLine[];
  /** Redemptions counting against the limit (reserved + confirmed). */
  totalRedemptions: number;
  /** Redemptions by this email counting against the per-customer limit. */
  redemptionsByThisEmail: number;
  /** Code already on the order, if any. */
  alreadyAppliedCode?: string | null;
}

/** A coupon that passed validation, in the shape the pricing engine consumes. */
export interface AppliedCoupon {
  couponId: string;
  /** Normalised (trimmed, upper-case) code. */
  code: string;
  kind: CouponKind;
  value: number;
  maxDiscountPaise: number | null;
  minSubtotalPaise: number | null;
  /** Lines the discount applies to. */
  eligibleLineIds: string[];
  /** Discount at validation time (0 for free_shipping). Pricing always recomputes. */
  discountPaise: number;
}

export type CouponRejectCode =
  | "inactive"
  | "not_started"
  | "expired"
  | "usage_exhausted"
  | "per_customer_exhausted"
  | "no_eligible_items"
  | "min_subtotal"
  | "stacking";

export type CouponResult =
  { ok: true; applied: AppliedCoupon } | { ok: false; code: CouponRejectCode; message: string };

/** Trim and upper-case a user-entered code. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function nonEmpty(list: readonly string[] | undefined): list is readonly string[] {
  return list !== undefined && list.length > 0;
}

/** True when the line is inside the coupon's scope (and not excluded). */
export function isLineEligible(scope: CouponScope, line: CartLine): boolean {
  if (nonEmpty(scope.excludeProducts) && scope.excludeProducts.includes(line.productId)) {
    return false;
  }
  const hasInclusion = nonEmpty(scope.vibes) || nonEmpty(scope.types) || nonEmpty(scope.products);
  if (!hasInclusion) {
    return true;
  }
  if (nonEmpty(scope.vibes) && line.vibeSlugs.some((v) => scope.vibes?.includes(v))) {
    return true;
  }
  if (nonEmpty(scope.types) && scope.types.includes(line.typeSlug)) {
    return true;
  }
  if (nonEmpty(scope.products) && scope.products.includes(line.productId)) {
    return true;
  }
  return false;
}

/**
 * Discount in paise for an eligible subtotal.
 * percent: `floor(eligible * bp / 10000)` capped by maxDiscount; fixed: `min(value, eligible)`;
 * free_shipping: 0 (shipping is waived by the pricing engine). Never exceeds the eligible subtotal.
 */
export function couponDiscountPaise(
  kind: CouponKind,
  value: number,
  maxDiscountPaise: number | null,
  eligibleSubtotalPaise: number,
): number {
  if (kind === "free_shipping" || eligibleSubtotalPaise <= 0) {
    return 0;
  }
  let discount: number;
  if (kind === "percent") {
    discount = Number((BigInt(eligibleSubtotalPaise) * BigInt(value)) / 10000n);
  } else {
    discount = Math.min(value, eligibleSubtotalPaise);
  }
  if (maxDiscountPaise !== null) {
    discount = Math.min(discount, maxDiscountPaise);
  }
  return Math.min(discount, eligibleSubtotalPaise);
}

function configValid(c: CouponRecord): boolean {
  if (c.kind === "percent") {
    return Number.isInteger(c.value) && c.value >= 1 && c.value <= 10000;
  }
  if (c.kind === "fixed") {
    return Number.isInteger(c.value) && c.value >= 1;
  }
  return true;
}

function reject(code: CouponRejectCode, message: string): CouponResult {
  return { ok: false, code, message };
}

export function validateCoupon(coupon: CouponRecord, ctx: CouponContext): CouponResult {
  const code = normalizeCode(coupon.code);

  if (!coupon.active || !configValid(coupon)) {
    return reject("inactive", `${code} isn't active right now.`);
  }
  if (coupon.startsAt !== null && ctx.now.getTime() < coupon.startsAt.getTime()) {
    return reject("not_started", `This code starts on ${formatIstDate(coupon.startsAt)}`);
  }
  if (coupon.endsAt !== null && ctx.now.getTime() > coupon.endsAt.getTime()) {
    return reject("expired", `This code expired on ${formatIstDate(coupon.endsAt)}`);
  }
  if (coupon.usageLimit !== null && ctx.totalRedemptions >= coupon.usageLimit) {
    return reject("usage_exhausted", "This code has been fully claimed.");
  }
  if (coupon.perCustomerLimit !== null && ctx.redemptionsByThisEmail >= coupon.perCustomerLimit) {
    return reject("per_customer_exhausted", "This code has already been used with your email.");
  }

  const eligible = ctx.lines.filter((l) => isLineEligible(coupon.scope, l));
  if (eligible.length === 0) {
    return reject("no_eligible_items", "This code doesn't apply to the items in your cart.");
  }

  const cartSubtotal = ctx.lines.reduce((s, l) => s + l.unitPricePaise * l.qty, 0);
  if (coupon.minSubtotalPaise !== null && cartSubtotal < coupon.minSubtotalPaise) {
    return reject(
      "min_subtotal",
      `Add ${formatINR(coupon.minSubtotalPaise - cartSubtotal)} more to use ${code}`,
    );
  }

  const already = ctx.alreadyAppliedCode ? normalizeCode(ctx.alreadyAppliedCode) : null;
  if (already !== null && already !== code) {
    return reject(
      "stacking",
      `Only one code can be used per order. Remove ${already} to use ${code}.`,
    );
  }

  const eligibleSubtotal = eligible.reduce((s, l) => s + l.unitPricePaise * l.qty, 0);
  return {
    ok: true,
    applied: {
      couponId: coupon.id,
      code,
      kind: coupon.kind,
      value: coupon.value,
      maxDiscountPaise: coupon.maxDiscountPaise,
      minSubtotalPaise: coupon.minSubtotalPaise,
      eligibleLineIds: eligible.map((l) => l.lineId),
      discountPaise: couponDiscountPaise(
        coupon.kind,
        coupon.value,
        coupon.maxDiscountPaise,
        eligibleSubtotal,
      ),
    },
  };
}
