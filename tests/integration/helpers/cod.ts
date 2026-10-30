import { getDb } from "@/server/db";
import { createFromCart } from "@/server/services/orders";

import { checkoutForm, makeCart } from "./factories";

/** Places a COD order for one unit of a variant and returns its id. */
export async function createOrderFromCartForTests(variantId: string): Promise<string> {
  const cart = await makeCart([{ variantId, qty: 1 }]);
  const r = await createFromCart(getDb(), {
    cartToken: cart.token,
    form: checkoutForm({ paymentMethod: "cod" }),
  });
  if (!r.ok) throw new Error(`COD order failed: ${r.error.code}`);
  return r.order.orderId;
}
