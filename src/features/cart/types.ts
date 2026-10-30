/**
 * Serialisable shapes returned by the cart and checkout Server Actions. Type-only re-exports of the
 * service view models (no runtime import of server code), so client components can import them.
 */
import type { CartNotice, CartView } from "@/server/services/cart";

export type {
  CartNotice,
  CartNoticeCode,
  CartView,
  CartViewCoupon,
  CartViewLine,
  CartViewPricing,
} from "@/server/services/cart";

export type ActionErrorCode =
  | "invalid_input"
  | "rate_limited"
  | "server_error"
  | "cart_not_found"
  | "invalid_qty"
  | "unavailable"
  | "sold_out"
  | "coupon"
  | "not_signed_in";

export interface ActionError {
  code: ActionErrorCode;
  /** Human message, safe to show. */
  message: string;
  /** Coupon rejection code when `code === "coupon"` (e.g. "min_subtotal"). */
  couponCode?: string;
  /** Seconds to wait when `code === "rate_limited"`. */
  retryAfterSeconds?: number;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/** What every cart mutation returns: the re-validated cart plus notices to show inline. */
export interface CartActionData {
  cart: CartView;
  /** Mutation notices followed by any the re-validation produced ("Only 2 left — ..."). */
  notices: CartNotice[];
}
