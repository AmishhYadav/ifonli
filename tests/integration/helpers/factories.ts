import { getDb } from "@/server/db";
import { productTypes, products, variants } from "@/server/db/schema";

let counter = 0;
const next = () => ++counter;

export async function makeType() {
  const n = next();
  const [row] = await getDb()
    .insert(productTypes)
    .values({ slug: `type-${n}`, name: `Type ${n}` })
    .returning();
  return row!;
}

export async function makeProduct(overrides: Partial<typeof products.$inferInsert> = {}) {
  const type = await makeType();
  const n = next();
  const [row] = await getDb()
    .insert(products)
    .values({ slug: `product-${n}`, name: `Product ${n}`, typeId: type.id, ...overrides })
    .returning();
  return row!;
}

export async function makeVariant(
  productId: string,
  overrides: Partial<typeof variants.$inferInsert> = {},
) {
  const n = next();
  const [row] = await getDb()
    .insert(variants)
    .values({
      productId,
      sku: `SKU-${n}`,
      pricePaise: 10000,
      mrpPaise: 12000,
      stockOnHand: 5,
      ...overrides,
    })
    .returning();
  return row!;
}

/** Unwraps Drizzle's query error to the underlying Postgres error code (e.g. 23514 = check). */
export async function pgErrorCode(promise: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    let e: unknown = error;
    while (e && typeof e === "object") {
      const code = (e as { code?: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
      e = (e as { cause?: unknown }).cause;
    }
    throw error;
  }
}

export const PG = {
  unique: "23505",
  check: "23514",
  foreignKey: "23503",
  notNull: "23502",
} as const;

// ---------------------------------------------------------------------------------------------
// Commerce (Phase 4) helpers
// ---------------------------------------------------------------------------------------------

/** Seeds the minimal states / pincodes the commerce tests use. */
export async function seedCommerceReference() {
  const { pincodes: pincodeTable, states: stateTable } = await import("@/server/db/schema");
  const db = getDb();
  await db.insert(stateTable).values([
    { code: "27", name: "Maharashtra", iso: "IN-MH", type: "state", zone: "rest_of_india" },
    { code: "07", name: "Delhi", iso: "IN-DL", type: "ut", zone: "metro_region" },
    { code: "29", name: "Karnataka", iso: "IN-KA", type: "state", zone: "rest_of_india" },
    { code: "35", name: "Andaman and Nicobar Islands", iso: "IN-AN", type: "ut", zone: "islands" },
  ]);
  await db.insert(pincodeTable).values([
    { pincode: "400001", district: "Mumbai", stateCode: "27", zone: "rest_of_india" },
    { pincode: "411001", district: "Pune", stateCode: "27", zone: "rest_of_india", codAllowed: false },
    { pincode: "110001", district: "Central Delhi", stateCode: "07", zone: "metro_region" },
    { pincode: "560001", district: "Bangalore", stateCode: "29", zone: "rest_of_india" },
    { pincode: "744101", district: "South Andaman", stateCode: "35", zone: "islands", serviceable: false },
  ]);
}

/**
 * Writes the business settings commerce reads (all non-placeholder). Defaults: store in Maharashtra,
 * flat shipping 50, free above 500, COD on with a 40 fee up to 5,000, 18% default GST, 15-minute
 * reservations, max 10 per line.
 */
export async function configureCommerce(
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { setSetting } = await import("@/server/services/settings");
  const values: Record<string, unknown> = {
    state: "Maharashtra",
    flat_fee: 5000,
    free_threshold: 50000,
    zone_overrides: {},
    processing_days: 1,
    delivery_estimates_by_zone: {
      metro_region: { minDays: 2, maxDays: 4 },
      rest_of_india: { minDays: 3, maxDays: 6 },
    },
    cod_enabled: true,
    cod_fee: 4000,
    cod_max_order_value: 500000,
    cod_excluded_pincodes: [],
    default_gst_rate_bp: 1800,
    shipping_tax_rule: "dominant_line_rate",
    reservation_ttl_minutes: 15,
    max_qty_per_line: 10,
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    await (setSetting as (k: string, v: unknown, a: string | null) => Promise<unknown>)(key, value, null);
  }
}

let couponSeq = 0;
export async function makeCoupon(
  overrides: Partial<typeof import("@/server/db/schema").coupons.$inferInsert> = {},
) {
  const { coupons: couponTable } = await import("@/server/db/schema");
  couponSeq += 1;
  const [row] = await getDb()
    .insert(couponTable)
    .values({ code: `TEST${couponSeq}`, kind: "percent", value: 1000, ...overrides })
    .returning();
  return row!;
}

/** Inserts a cart directly (token, optional owner / coupon) with the given lines. */
export async function makeCart(
  items: { variantId: string; qty: number }[] = [],
  opts: { couponCode?: string | null; userId?: string | null } = {},
) {
  const { cartItems: itemTable, carts: cartTable } = await import("@/server/db/schema");
  const { newCartToken } = await import("@/server/services/cart");
  const db = getDb();
  const [cart] = await db
    .insert(cartTable)
    .values({
      token: newCartToken(),
      couponCode: opts.couponCode ?? null,
      userId: opts.userId ?? null,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  if (items.length > 0) {
    await db.insert(itemTable).values(items.map((i) => ({ cartId: cart!.id, ...i })));
  }
  return cart!;
}

/** A valid checkout form (raw input of `placeOrderSchema`); each call gets a fresh idempotency key. */
export function checkoutForm(overrides: Record<string, unknown> = {}) {
  return {
    email: "Buyer@Example.com",
    phone: "98765 43210",
    shippingAddress: {
      name: "Asha Rao",
      line1: "12 Marine Drive",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
    },
    paymentMethod: "razorpay",
    policyAck: true,
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Payments helpers
// ---------------------------------------------------------------------------------------------

/**
 * Places a prepaid order through the real `createFromCart` with the real payment initiator wired to
 * `provider` (the in-memory mock). Returns the order, the Checkout.js payload and the raw guest token.
 */
export async function placePrepaidOrder(
  provider: import("@/server/payments/mock").MockPaymentProvider,
  items: { variantId: string; qty: number }[],
  opts: { form?: Record<string, unknown>; couponCode?: string | null; now?: Date } = {},
) {
  const { createFromCart } = await import("@/server/services/orders");
  const { initiateOrderPayment } = await import("@/server/payments/initiate");
  const cart = await makeCart(items, { couponCode: opts.couponCode ?? null });
  const r = await createFromCart(getDb(), {
    cartToken: cart.token,
    form: checkoutForm(opts.form),
    now: opts.now,
    initiatePayment: (ctx) => initiateOrderPayment(ctx, { provider }),
  });
  if (!r.ok) throw new Error(`placePrepaidOrder failed: ${r.error.code} ${r.error.message}`);
  if (!r.payment) throw new Error("placePrepaidOrder: no payment payload");
  return { cart, order: r.order, payment: r.payment, token: r.order.accessToken };
}

/** The body Checkout.js' success handler would POST to the verify endpoint. */
export function verifyBody(
  provider: import("@/server/payments/mock").MockPaymentProvider,
  placed: Awaited<ReturnType<typeof placePrepaidOrder>>,
  payment: import("@/server/payments/provider").ProviderPayment,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...provider.checkoutResponse(payment),
    ref: placed.order.ref,
    token: placed.token,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Admin orders helpers
// ---------------------------------------------------------------------------------------------

/** A prepaid order that has been paid through the real `finalizePaidOrder` (mock provider). */
export async function placePaidOrder(
  provider: import("@/server/payments/mock").MockPaymentProvider,
  items: { variantId: string; qty: number }[],
  opts: { form?: Record<string, unknown>; couponCode?: string | null } = {},
) {
  const { finalizePaidOrder } = await import("@/server/services/payments");
  const placed = await placePrepaidOrder(provider, items, opts);
  const paid = provider.simulatePayment(placed.payment.razorpayOrderId);
  await finalizePaidOrder(
    getDb(),
    placed.order.orderId,
    { providerOrderId: paid.orderId!, providerPaymentId: paid.id, amountPaise: paid.amountPaise, method: paid.method },
    { provider },
  );
  return { ...placed, paid };
}

/** A confirmed COD order (stock decremented, invoice number assigned). */
export async function placeCodOrder(
  items: { variantId: string; qty: number }[],
  opts: { form?: Record<string, unknown>; couponCode?: string | null } = {},
) {
  const { createFromCart } = await import("@/server/services/orders");
  const cart = await makeCart(items, { couponCode: opts.couponCode ?? null });
  const r = await createFromCart(getDb(), {
    cartToken: cart.token,
    form: checkoutForm({ paymentMethod: "cod", ...opts.form }),
  });
  if (!r.ok) throw new Error(`placeCodOrder failed: ${r.error.code} ${r.error.message}`);
  return { order: r.order, token: r.order.accessToken };
}

// ---------------------------------------------------------------------------------------------
// Notifications helpers
// ---------------------------------------------------------------------------------------------

/** A confirmed COD order placed with the real checkout hook, so the cod_placed / new_order outbox rows exist. */
export async function placeCodOrderNotified(
  items: { variantId: string; qty: number }[],
  opts: { form?: Record<string, unknown> } = {},
) {
  const { createFromCart } = await import("@/server/services/orders");
  const { onOrderPlacedInTransaction } = await import("@/server/notify/order-hooks");
  const cart = await makeCart(items);
  const r = await createFromCart(getDb(), {
    cartToken: cart.token,
    form: checkoutForm({ paymentMethod: "cod", ...opts.form }),
    hooks: { onPlacedInTransaction: onOrderPlacedInTransaction },
  });
  if (!r.ok) throw new Error(`placeCodOrderNotified failed: ${r.error.code} ${r.error.message}`);
  return { order: r.order, token: r.order.accessToken };
}
