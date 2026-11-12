import "server-only";

import type { CodEligibility, DeliveryEstimate, GstSplit, PaymentMethod } from "@/server/domain";

import { getCartState, type CartView } from "./cart";
import {
  checkServiceability,
  estimateDelivery,
  evaluateCod,
  lookupPincodeInfo,
  PINCODE_RE,
  type PincodeInfo,
  type Serviceability,
} from "./commerce/pincode";
import { quoteLines, type CommerceSettings, type Quote, type QuoteCoupon } from "./pricing";
import type { CartLine } from "@/server/domain";
import type { DbClient } from "./queries/shared";

export { checkServiceability, evaluateCod, estimateDelivery, lookupPincodeInfo };
export type { PincodeInfo, Serviceability };

/* ------------------------------------------------------------------------------------------ */
/* Pincode lookup (autofill + live serviceability / COD)                                      */
/* ------------------------------------------------------------------------------------------ */

export type PincodeLookupStatus = "ok" | "invalid" | "unknown" | "unserviceable";

export interface PincodeLookup {
  pincode: string;
  status: PincodeLookupStatus;
  /** Human text for `invalid` / `unknown` / `unserviceable`, else null. */
  message: string | null;
  /** Autofill: the directory's district and the state name (null when not found). */
  city: string | null;
  state: string | null;
  stateCode: string | null;
  zone: string | null;
  serviceable: boolean;
  /** Pincode-level COD permission (directory flag and the excluded list); ignores order value. */
  codAllowed: boolean;
}

/** Pincode -> city / state autofill with serviceability and COD flags. Never throws for bad input. */
export async function lookupPincodeForCheckout(
  db: DbClient,
  pincode: string,
  settings: Pick<CommerceSettings, "cod">,
): Promise<PincodeLookup> {
  const info = PINCODE_RE.test(pincode) ? await lookupPincodeInfo(db, pincode) : null;
  const service = checkServiceability(pincode, info);
  return {
    pincode,
    status: service.serviceable
      ? "ok"
      : service.code === "invalid_pincode"
        ? "invalid"
        : service.code === "unknown_pincode"
          ? "unknown"
          : "unserviceable",
    message: service.serviceable ? null : service.message,
    city: info?.district ?? null,
    state: info?.stateName ?? null,
    stateCode: info?.stateCode ?? null,
    zone: info?.zone ?? null,
    serviceable: service.serviceable,
    codAllowed: info !== null && info.codAllowed && !settings.cod.excludedPincodes.includes(info.pincode),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Assessment: the shared pricing + eligibility step (checkout quote AND order creation)      */
/* ------------------------------------------------------------------------------------------ */

export interface CheckoutAssessmentInput {
  lines: readonly CartLine[];
  couponCode: string | null;
  email?: string | null;
  pincode: string | null;
  paymentMethod: PaymentMethod;
  settings: CommerceSettings;
  now: Date;
  lockCoupon?: boolean;
}

export interface CheckoutAssessment {
  /** Price for the requested payment method (COD fee included for `cod`). */
  quote: Quote;
  pincode: PincodeInfo | null;
  serviceability: Serviceability;
  /** COD eligibility for this order (based on the total before the COD fee). */
  cod: CodEligibility;
  delivery: DeliveryEstimate | null;
  /** Total if paid online. */
  prepaidTotalPaise: number;
  /** Total if paid by COD (adds the COD fee). */
  codTotalPaise: number;
}

/**
 * Prices the lines for the requested method and works out serviceability, COD eligibility (plan
 * 7.9) and the delivery estimate. Order creation calls this with the locked / re-read lines, so
 * what the customer was quoted and what is charged come from the same code.
 */
export async function assessCheckout(
  db: DbClient,
  input: CheckoutAssessmentInput,
): Promise<CheckoutAssessment> {
  const info = input.pincode && PINCODE_RE.test(input.pincode)
    ? await lookupPincodeInfo(db, input.pincode)
    : null;
  const base = {
    lines: input.lines,
    couponCode: input.couponCode,
    email: input.email,
    pincode: input.pincode,
    pincodeInfo: info,
    settings: input.settings,
    now: input.now,
    lockCoupon: input.lockCoupon,
  };
  const quote = await quoteLines(db, { ...base, paymentMethod: input.paymentMethod });
  // The two totals differ only by the COD fee; price the other method once for the payment picker.
  const other =
    input.paymentMethod === "cod"
      ? await quoteLines(db, { ...base, paymentMethod: "razorpay", lockCoupon: false })
      : await quoteLines(db, { ...base, paymentMethod: "cod", lockCoupon: false });
  const prepaid = input.paymentMethod === "cod" ? other : quote;
  const codQuote = input.paymentMethod === "cod" ? quote : other;
  return {
    quote,
    pincode: info,
    serviceability: checkServiceability(input.pincode ?? "", info),
    cod: evaluateCod(input.settings, info, prepaid.price.totalPaise),
    delivery: estimateDelivery(input.settings, info, input.now),
    prepaidTotalPaise: prepaid.price.totalPaise,
    codTotalPaise: codQuote.price.totalPaise,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Checkout quote (live, as the customer fills the form)                                      */
/* ------------------------------------------------------------------------------------------ */

export interface CheckoutPricing {
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  /** Total payable. */
  totalPaise: number;
  /** "Includes ₹X GST". */
  taxIncludedPaise: number;
  /** CGST / SGST / IGST split when the delivery state is known. */
  gst: GstSplit | null;
  savingsVsMrpPaise: number;
  freeShippingRemainingPaise: number | null;
  messages: string[];
  /** Per line allocation (same order as `cart.lines`). */
  lines: { variantId: string; discountAllocPaise: number; lineTotalPaise: number }[];
}

export interface CheckoutQuote {
  /** Re-validated cart (lines, notices, version). Its `pricing` excludes pincode and COD fee. */
  cart: CartView;
  /** null until a pincode is entered. */
  pincode: PincodeLookup | null;
  delivery: { fromDate: string; toDate: string } | null;
  coupon: QuoteCoupon | null;
  payment: {
    razorpay: { available: boolean; totalPaise: number };
    cod: { available: boolean; reason: string | null; feePaise: number; totalPaise: number };
  };
  /** The method `pricing` is computed for. */
  paymentMethod: PaymentMethod;
  pricing: CheckoutPricing;
  /** Human reasons the order cannot be placed yet (empty cart, bad pincode, COD not allowed...). */
  blockers: string[];
  canPlaceOrder: boolean;
}

export interface CheckoutQuoteRequest {
  pincode?: string | null;
  paymentMethod?: PaymentMethod | null;
  email?: string | null;
  now?: Date;
}

/**
 * Quote for the checkout page: re-validates the cart, prices it for the entered pincode and chosen
 * payment method, and reports serviceability, COD eligibility (with the reason when not eligible),
 * the delivery estimate and both totals. Choosing COD while it is not allowed falls back to
 * prepaid pricing and adds a blocker.
 */
export async function getCheckoutQuote(
  db: DbClient,
  cartId: string,
  req: CheckoutQuoteRequest = {},
): Promise<CheckoutQuote> {
  const now = req.now ?? new Date();
  const state = await getCartState(db, cartId, { now, email: req.email });
  const pincodeInput = req.pincode && PINCODE_RE.test(req.pincode) ? req.pincode : null;
  const requested: PaymentMethod = req.paymentMethod ?? "razorpay";

  const a = await assessCheckout(db, {
    lines: state.lines,
    couponCode: state.couponCode,
    email: req.email,
    pincode: pincodeInput,
    paymentMethod: requested,
    settings: state.settings,
    now,
  });

  const blockers: string[] = [];
  if (state.lines.length === 0) blockers.push("Your bag is empty.");
  if (state.view.coupon && !state.view.coupon.applied && state.view.coupon.message) {
    blockers.push(state.view.coupon.message);
  }
  const lookup = pincodeInput
    ? await lookupPincodeForCheckout(db, pincodeInput, state.settings)
    : req.pincode
      ? await lookupPincodeForCheckout(db, req.pincode, state.settings)
      : null;
  if (!lookup) blockers.push("Enter your delivery pincode.");
  else if (!lookup.serviceable && lookup.message) blockers.push(lookup.message);
  if (requested === "cod" && !a.cod.eligible) blockers.push(a.cod.reason);

  const effective: PaymentMethod = requested === "cod" && !a.cod.eligible ? "razorpay" : requested;
  const priced =
    effective === requested
      ? a.quote
      : (await assessCheckout(db, {
          lines: state.lines,
          couponCode: state.couponCode,
          email: req.email,
          pincode: pincodeInput,
          paymentMethod: effective,
          settings: state.settings,
          now,
        })).quote;
  const price = priced.price;
  const codFee = state.settings.cod.feePaise;

  return {
    cart: state.view,
    pincode: lookup,
    delivery: a.delivery,
    coupon: priced.coupon,
    payment: {
      razorpay: { available: true, totalPaise: a.prepaidTotalPaise },
      cod: {
        available: a.cod.eligible,
        reason: a.cod.eligible ? null : a.cod.reason,
        feePaise: codFee,
        totalPaise: a.codTotalPaise,
      },
    },
    paymentMethod: effective,
    pricing: {
      subtotalPaise: price.subtotalPaise,
      discountPaise: price.discountPaise,
      shippingPaise: price.shippingPaise,
      codFeePaise: price.codFeePaise,
      totalPaise: price.totalPaise,
      taxIncludedPaise: price.taxIncludedPaise,
      gst: price.gst,
      savingsVsMrpPaise: price.savingsVsMrpPaise,
      freeShippingRemainingPaise: price.freeShippingRemainingPaise,
      messages: price.messages.map((m) => m.text),
      lines: price.lines.map((l) => ({
        variantId: l.variantId,
        discountAllocPaise: l.discountAllocPaise,
        lineTotalPaise: l.lineTotalPaise,
      })),
    },
    blockers,
    canPlaceOrder: blockers.length === 0 && state.view.canCheckout,
  };
}
