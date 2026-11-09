import type { Vibe } from "@/features/vibe/config";

import type { PayloadOf, TemplateName } from "./payloads";
import type { EmailContext, OrderView } from "./types";

/** Sample data for the dev preview route and the unit tests. Not real people or a real address. */
export const FIXTURE_ORDER: OrderView = {
  ref: "IFO-2611-7K3Q",
  paymentMethod: "razorpay",
  placedAt: "2026-11-02T10:15:00.000Z",
  items: [
    { name: "Skull Mug", variant: "Matte black", qty: 2, unitPaise: 59900, grossPaise: 119800 },
    { name: "Tiny Cactus Sticker Pack", variant: "", qty: 1, unitPaise: 19900, grossPaise: 19900 },
  ],
  subtotalPaise: 139700,
  discountPaise: 13970,
  shippingPaise: 0,
  codFeePaise: 0,
  totalPaise: 125730,
  taxIncludedPaise: 19179,
  couponCode: "WELCOME10",
  shipTo: { name: "Asha Rao", lines: ["12 Marine Drive", "Mumbai, Maharashtra 400001"] },
};

export function fixtureContext(vibe: Vibe | null = null, order: Partial<OrderView> = {}): EmailContext {
  return {
    store: {
      brandName: "IfOnli",
      legalName: "Example Retail Pvt Ltd",
      address: "1 Sample Road, Mumbai, Maharashtra 400001",
      supportEmail: "care@example.test",
      supportPhone: "+91 98000 00000",
      supportHours: "Mon-Sat, 10:00-18:00 IST",
    },
    siteUrl: "https://ifonli.example.test",
    vibe,
    order: { ...FIXTURE_ORDER, ...order },
    invoiceAttached: true,
  };
}

export const FIXTURE_PAYLOADS: { [T in TemplateName]: PayloadOf<T> } = {
  order_confirmed: { ref: "IFO-2611-7K3Q", orderId: "0b8c5c1e-6f4a-4f3b-9d7e-1a2b3c4d5e6f", totalPaise: 125730, paymentMethod: "razorpay" },
  cod_placed: { ref: "IFO-2611-7K3Q", orderId: "0b8c5c1e-6f4a-4f3b-9d7e-1a2b3c4d5e6f", totalPaise: 125730 },
  payment_failed: { ref: "IFO-2611-7K3Q" },
  order_shipped: {
    ref: "IFO-2611-7K3Q",
    courier: "Delhivery",
    awb: "DL1234567890",
    trackingUrl: "https://www.delhivery.com/track/package/DL1234567890",
  },
  order_delivered: { ref: "IFO-2611-7K3Q" },
  order_cancelled: { ref: "IFO-2611-7K3Q" },
  refund_initiated: { ref: "IFO-2611-7K3Q", refundId: "r-1", amountPaise: 125730 },
  refund_processed: { ref: "IFO-2611-7K3Q", refundId: "r-1", amountPaise: 125730 },
  payment_late_refund: { ref: "IFO-2611-7K3Q", refundId: "r-1", amountPaise: 125730 },
  support_case_update: {
    ref: "IFO-2611-7K3Q",
    caseId: "c-1",
    status: "resolved",
    resolution: "replacement",
    note: "Sorry about the cracked handle. A replacement mug ships tomorrow; no need to return the damaged one.",
  },
  contact_ack: { name: "Asha Rao" },
  contact_reply: {
    name: "Asha Rao",
    message:
      "Yes, we can change the address until the parcel is packed. Your order has not been packed yet, so we have updated it.\n\nThanks for writing in.",
    original: "Can I change the delivery address?",
  },
  login_otp: { otp: "482913", type: "sign-in", expiresMinutes: 10 },
  new_order: { ref: "IFO-2611-7K3Q", orderId: "0b8c5c1e-6f4a-4f3b-9d7e-1a2b3c4d5e6f", totalPaise: 125730, paymentMethod: "razorpay" },
  low_stock_digest: {
    total: 3,
    rows: [
      { sku: "SKU-MUG-BLK", productName: "Skull Mug", variantTitle: "Matte black", available: 0, threshold: 5 },
      { sku: "SKU-STK-CAC", productName: "Tiny Cactus Sticker Pack", variantTitle: "", available: 2, threshold: 5 },
      { sku: "SKU-TEE-M", productName: "Unapologetic Tee", variantTitle: "M", available: 4, threshold: 5 },
    ],
  },
  payment_anomaly: {
    kind: "amount_mismatch",
    ref: "IFO-2611-7K3Q",
    orderId: "0b8c5c1e-6f4a-4f3b-9d7e-1a2b3c4d5e6f",
    providerPaymentId: "pay_Example123",
    capturedPaise: 100000,
    orderTotalPaise: 125730,
  },
  new_support_case: { ref: "IFO-2611-7K3Q", caseId: "c-1", type: "damaged", description: "The handle arrived cracked.\nPhotos attached on the case." },
  new_contact: { name: "Asha Rao", email: "asha@example.test", orderRef: "IFO-2611-7K3Q", message: "Can I change the delivery address?" },
  outbox_failure: { template: "order_confirmed", outboxId: "0f0f0f0f-0000-4000-8000-000000000000", attempts: 6, error: "Resend: rate_limit_exceeded", orderRef: "IFO-2611-7K3Q" },
};
