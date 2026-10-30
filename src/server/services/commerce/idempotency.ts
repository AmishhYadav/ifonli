import { createHash } from "node:crypto";

/**
 * Stable fingerprint of everything that defines an order besides the cart contents (payment
 * method, contact, address; the coupon is part of the cart and moves its version). Same fingerprint + same cart version + same client key means
 * "the same submit again"; change any of them and a new order is created instead of replaying.
 */
export function checkoutFingerprint(parts: {
  paymentMethod: string;
  email: string;
  phone: string;
  address: {
    name: string;
    line1: string;
    line2?: string | undefined;
    landmark?: string | undefined;
    city: string;
    state: string;
    pincode: string;
  };
}): string {
  const a = parts.address;
  const canonical = JSON.stringify([
    parts.paymentMethod,
    parts.email.trim().toLowerCase(),
    parts.phone,
    a.name,
    a.line1,
    a.line2 ?? "",
    a.landmark ?? "",
    a.city,
    a.state,
    a.pincode,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

/**
 * `orders.idempotency_key` (plan 7.5): cart id + cart version + order fingerprint + the key the form
 * generated. The cart version moves on every cart change, so an edited cart is a new order.
 */
export function composeIdempotencyKey(input: {
  cartId: string;
  cartVersion: number;
  fingerprint: string;
  clientKey: string;
}): string {
  return `${input.cartId}:v${input.cartVersion}:${input.fingerprint}:${input.clientKey}`;
}
