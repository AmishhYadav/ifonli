/** Shared domain types. No runtime code. */

/** Shipping zone key (data-driven, see data/reference/zones.json), e.g. "metro_region". */
export type Zone = string;

export type PaymentMethod = "razorpay" | "cod";

/** One cart line as the pricing engine and coupon validator see it. All money is integer paise. */
export interface CartLine {
  lineId: string;
  variantId: string;
  productId: string;
  typeSlug: string;
  vibeSlugs: string[];
  /** GST-inclusive selling price per unit. */
  unitPricePaise: number;
  /** Legal MRP per unit (inclusive of all taxes). Must be >= unitPricePaise. */
  mrpPaise: number;
  qty: number;
  /** GST rate in basis points (1800 = 18%). */
  gstRateBp: number;
}
