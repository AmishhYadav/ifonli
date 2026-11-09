import type { Vibe } from "@/features/vibe/config";

/** Store details printed in every footer (settings; never hard-coded in a template). */
export interface StoreInfo {
  brandName: string;
  legalName: string;
  address: string;
  supportEmail: string;
  supportPhone: string;
  supportHours: string;
}

export interface OrderViewItem {
  name: string;
  variant: string;
  qty: number;
  unitPaise: number;
  /** unit price x qty, before any coupon share (the coupon is its own line). */
  grossPaise: number;
}

/** What an order e-mail needs, read from the order row at send time (the outbox payload stays thin). */
export interface OrderView {
  ref: string;
  paymentMethod: "razorpay" | "cod";
  placedAt: string;
  items: OrderViewItem[];
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
  /** GST contained in the total (prices are inclusive; never added on top). */
  taxIncludedPaise: number;
  couponCode: string | null;
  shipTo: { name: string; lines: string[] };
}

export interface EmailContext {
  store: StoreInfo;
  /** Origin without trailing slash, e.g. https://ifonli.in. */
  siteUrl: string;
  /** Vibe active at checkout; null = neutral palette. */
  vibe: Vibe | null;
  order?: OrderView;
  /** True when the invoice PDF travels with this e-mail. */
  invoiceAttached?: boolean;
}
