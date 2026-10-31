import type { CartView } from "@/features/cart/types";

/** Client-safe empty cart (the service's `emptyCartView` lives in a server-only module). */
export const EMPTY_CART_VIEW: CartView = {
  cartId: null,
  version: 0,
  lines: [],
  itemCount: 0,
  coupon: null,
  pricing: {
    subtotalPaise: 0,
    discountPaise: 0,
    shippingPaise: 0,
    totalPaise: 0,
    taxIncludedPaise: 0,
    savingsVsMrpPaise: 0,
    freeShippingRemainingPaise: null,
    freeThresholdPaise: null,
    messages: [],
  },
  notices: [],
  canCheckout: false,
};
