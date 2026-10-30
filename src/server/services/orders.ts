import "server-only";

import { and, asc, eq, inArray, lte } from "drizzle-orm";

import {
  cartItems,
  carts,
  orderEvents,
  orderItems,
  orders,
  policies,
  stockReservations,
  vibes,
} from "@/server/db/schema";
import { placeOrderSchema, type CheckoutFormValues } from "@/features/checkout/schema";
import {
  assertTransition,
  createAccessToken,
  customerStatusLabel,
  generateOrderRef,
  hashAccessToken,
  normalizeOrderRef,
  verifyAccessToken,
  type CustomerStatusLabel,
  type FulfillmentStatus,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/server/domain";

import { assessCheckout } from "./checkout";
import { findCartByToken } from "./cart";
import { confirmRedemption, releaseRedemption, reserveRedemption } from "./coupons";
import { composeIdempotencyKey, checkoutFingerprint } from "./commerce/idempotency";
import type { PaymentInitiator, RazorpayCheckoutPayload } from "./commerce/payment-hook";
import { loadCommerceSettings } from "./commerce/settings";
import { adjustStock, InsufficientStockError } from "./inventory";
import { loadVariantSnapshots, toCartLine } from "./pricing";
import type { DbClient } from "./queries/shared";
import { loadVariantStock } from "./queries/stock";

export type { PaymentInitiator, RazorpayCheckoutPayload };

/* ------------------------------------------------------------------------------------------ */
/* Types                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export type OrderErrorCode =
  | "invalid_input"
  | "cart_not_found"
  | "empty_cart"
  | "not_serviceable"
  | "cod_unavailable"
  | "coupon_invalid"
  | "insufficient_stock"
  | "invalid_total"
  | "checkout_expired"
  | "payment_init_failed";

export interface ShortageItem {
  variantId: string;
  /** Product name (with the variant title when it has one). */
  name: string;
  requested: number;
  /** Units that can be bought right now. */
  available: number;
  reason: "sold_out" | "insufficient" | "unavailable" | "max_per_line";
  /** Human text for this line. */
  message: string;
}

export interface OrderError {
  code: OrderErrorCode;
  message: string;
  /** Per-item problems for `insufficient_stock`. */
  items?: ShortageItem[];
  /** Per-field messages for `invalid_input` (dotted path -> message). */
  fieldErrors?: Record<string, string>;
}

/** Thrown inside the order transaction to roll it back with a typed error. */
class OrderCreationError extends Error {
  constructor(readonly error: OrderError) {
    super(error.message);
    this.name = "OrderCreationError";
  }
}

export interface PlacedOrder {
  orderId: string;
  /** Human reference, e.g. IFO-2611-7K3Q. */
  ref: string;
  /** Raw guest access token for `?t=` links. Shown ONCE (only its hash is stored). */
  accessToken: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  /** Amount to charge. */
  totalPaise: number;
  taxIncludedPaise: number;
  currency: "INR";
  email: string;
  phone: string;
  couponCode: string | null;
  /** Reservation / payment deadline (prepaid only). */
  expiresAt: Date | null;
  /** True for prepaid orders still waiting for payment. */
  requiresPayment: boolean;
}

export interface CreateFromCartHooks {
  /**
   * Runs inside the order transaction after the order, items and stock have been written, before
   * commit. The notifications module writes its outbox rows here (plan 7.10): they commit or roll
   * back with the order.
   */
  onPlacedInTransaction?: (tx: DbClient, order: PlacedOrder) => Promise<void>;
}

export interface CreateFromCartInput {
  /** The httpOnly `cart_token` cookie value. */
  cartToken: string;
  /** Checkout form values plus `idempotencyKey` and `vibe` (see `placeOrderSchema`). Validated here. */
  form: unknown;
  userId?: string | null;
  now?: Date;
  /**
   * Prepaid only. Creates the provider order OUTSIDE the transaction (plan 7.5 step 4) after the
   * order and reservation are committed. On `{ ok: false }` (or a throw) the order is expired again
   * and `payment_init_failed` is returned. It is also called when a prepaid order is replayed, so it
   * must be idempotent per order (return the existing provider order).
   */
  initiatePayment?: PaymentInitiator;
  hooks?: CreateFromCartHooks;
}

export type CreateFromCartResult =
  | {
      ok: true;
      /** True when this was a repeat submit and the existing order is returned. */
      replayed: boolean;
      order: PlacedOrder;
      /** Checkout.js payload for prepaid orders when an initiator was supplied, else null. */
      payment: RazorpayCheckoutPayload | null;
      /** Products whose availability changed (for `revalidateStock`). */
      productIds: string[];
    }
  | { ok: false; error: OrderError };

type OrderRow = typeof orders.$inferSelect;

const RELEASE_REASON = {
  payment_init_failed: "Payment could not be started, so the reservation was released.",
  superseded: "Replaced by a newer checkout of the same cart.",
  expired: "Payment window ended; stock and coupon released.",
} as const;

function displayName(s: { productName: string; variantTitle: string }): string {
  return s.variantTitle && s.variantTitle !== "Default"
    ? `${s.productName} (${s.variantTitle})`
    : s.productName;
}

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** "privacy:2,returns-refunds:1,terms:3": the published versions the customer ticked the box for. */
async function currentPolicyVersions(db: DbClient): Promise<string> {
  const rows = await db
    .select({ slug: policies.slug, version: policies.version })
    .from(policies)
    .where(and(eq(policies.published, true), inArray(policies.slug, ["returns-refunds", "privacy", "terms"])))
    .orderBy(asc(policies.slug));
  return rows.length > 0 ? rows.map((r) => `${r.slug}:${r.version}`).join(",") : "unversioned";
}

async function resolveVibeSlug(db: DbClient, slug: string | null | undefined): Promise<string | null> {
  if (!slug) return null;
  const [row] = await db.select({ slug: vibes.slug }).from(vibes).where(eq(vibes.slug, slug)).limit(1);
  return row?.slug ?? null;
}

function toPlacedOrder(row: OrderRow, accessToken: string): PlacedOrder {
  return {
    orderId: row.id,
    ref: row.ref,
    accessToken,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    subtotalPaise: row.subtotalPaise,
    discountPaise: row.discountPaise,
    shippingPaise: row.shippingPaise,
    codFeePaise: row.codFeePaise,
    totalPaise: row.totalPaise,
    taxIncludedPaise: row.taxIncludedPaise,
    currency: "INR",
    email: row.email,
    phone: row.phone ?? "",
    couponCode: row.couponCode,
    expiresAt: row.expiresAt,
    requiresPayment: row.paymentMethod === "razorpay" && row.status === "pending_payment",
  };
}

/**
 * Mints a fresh guest access token for an order, replacing the stored hash (a previously issued
 * raw token stops working: there is one valid token per order). The raw token cannot be recovered
 * from the hash, so a replayed submit and the confirmation email each need a fresh one.
 */
export async function issueOrderAccessToken(db: DbClient, orderId: string): Promise<string> {
  const { token, hash } = createAccessToken();
  await db.update(orders).set({ accessTokenHash: hash }).where(eq(orders.id, orderId));
  return token;
}

async function addEvent(
  db: DbClient,
  orderId: string,
  e: { type: string; from?: string | null; to?: string | null; note?: string | null; visible?: boolean },
): Promise<void> {
  await db.insert(orderEvents).values({
    orderId,
    type: e.type,
    fromValue: e.from ?? null,
    toValue: e.to ?? null,
    note: e.note ?? null,
    visibleToCustomer: e.visible ?? false,
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Expiry / release                                                                           */
/* ------------------------------------------------------------------------------------------ */

async function expireLocked(
  tx: DbClient,
  orderId: string,
  opts: { now: Date; reason: keyof typeof RELEASE_REASON; onlyIfDue: boolean },
): Promise<boolean> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!o || o.status !== "pending_payment") return false;
  if (opts.onlyIfDue && (!o.expiresAt || o.expiresAt.getTime() > opts.now.getTime())) return false;
  assertTransition("status", "pending_payment", "expired");
  await tx.update(orders).set({ status: "expired" }).where(eq(orders.id, orderId));
  await tx
    .update(stockReservations)
    .set({ status: "released" })
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
  await releaseRedemption(tx, orderId);
  await addEvent(tx, orderId, {
    type: "order_expired",
    from: "pending_payment",
    to: "expired",
    note: RELEASE_REASON[opts.reason],
    visible: opts.reason !== "superseded",
  });
  return true;
}

/**
 * Expires one `pending_payment` order now (status `expired`): its stock reservations are released,
 * its coupon redemption freed and an `order_events` row written, all in one transaction. A no-op
 * (`expired: false`) for any other status, so it is safe to call repeatedly.
 */
export async function expireOrder(
  db: DbClient,
  orderId: string,
  opts: { now?: Date; reason?: "payment_init_failed" | "expired" } = {},
): Promise<{ expired: boolean }> {
  const now = opts.now ?? new Date();
  const expired = await db.transaction((tx) =>
    expireLocked(tx, orderId, { now, reason: opts.reason ?? "expired", onlyIfDue: false }),
  );
  return { expired };
}

/**
 * Cleanup sweep (cron, plan 7.6): expires every `pending_payment` order whose `expires_at` has
 * passed. Correctness never depends on it (availability ignores expired reservations at read
 * time); it keeps statuses, reservations and coupon counts tidy. Returns the ids it expired.
 */
export async function releaseExpiredReservations(
  db: DbClient,
  now: Date = new Date(),
  opts: { limit?: number } = {},
): Promise<{ expired: number; orderIds: string[] }> {
  const due = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "pending_payment"), lte(orders.expiresAt, now)))
    .orderBy(asc(orders.expiresAt))
    .limit(Math.min(Math.max(1, opts.limit ?? 200), 1000));
  const orderIds: string[] = [];
  for (const { id } of due) {
    // Re-checked under the row lock, so an order paid a moment ago is left alone.
    const done = await db.transaction((tx) =>
      expireLocked(tx, id, { now, reason: "expired", onlyIfDue: true }),
    );
    if (done) orderIds.push(id);
  }
  return { expired: orderIds.length, orderIds };
}

/* ------------------------------------------------------------------------------------------ */
/* createFromCart (plan 7.5)                                                                  */
/* ------------------------------------------------------------------------------------------ */

type TxOutcome = { kind: "created" | "replay"; order: OrderRow; token: string; productIds: string[] };

/**
 * Turns the cart into an order (plan 7.5). Server-side truth throughout: prices, GST, shipping and
 * COD fee are recomputed with the shared pricing function; the coupon, address, serviceability and
 * COD eligibility are re-validated.
 *
 *  - Idempotent: the same submit again (same cart version, details and client key) returns the
 *    existing order (`replayed: true`, with a fresh access token).
 *  - ONE transaction: locks the cart row, then `SELECT ... FROM variants WHERE id IN (...) ORDER BY
 *    id FOR UPDATE`, recomputes availability and aborts with per-item shortages. Concurrent buyers
 *    of the last unit therefore serialise: exactly one wins.
 *  - Prepaid: `pending_payment` / `unpaid`, `stock_reservations` until now + reservation_ttl_minutes.
 *    COD: `confirmed` / `cod_pending`, stock decremented now via the ledger (`sale`), the cart cleared.
 *  - A newer checkout of the same cart supersedes (expires) its earlier pending order, so the
 *    customer never competes with their own reservation.
 *  - The coupon redemption is reserved (confirmed straight away for COD).
 *  - The provider order is created afterwards via `initiatePayment`, outside the transaction.
 */
export async function createFromCart(
  db: DbClient,
  input: CreateFromCartInput,
): Promise<CreateFromCartResult> {
  const now = input.now ?? new Date();

  const parsed = placeOrderSchema.safeParse(input.form);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "form";
      fieldErrors[path] ??= issue.message;
    }
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "Please check the highlighted fields.",
        fieldErrors,
      },
    };
  }
  const form = parsed.data;

  const cartRow = await findCartByToken(db, input.cartToken);
  if (!cartRow) {
    return {
      ok: false,
      error: { code: "cart_not_found", message: "We couldn't find your cart. Please refresh the page." },
    };
  }

  let outcome: TxOutcome;
  try {
    outcome = await db.transaction((tx) => runOrderTransaction(tx, cartRow.id, form, input, now));
  } catch (e) {
    if (e instanceof OrderCreationError) return { ok: false, error: e.error };
    throw e;
  }

  const placed = toPlacedOrder(outcome.order, outcome.token);

  let payment: RazorpayCheckoutPayload | null = null;
  if (placed.requiresPayment && input.initiatePayment && outcome.order.expiresAt) {
    const address = outcome.order.shippingAddress as { name?: string };
    let result;
    try {
      result = await input.initiatePayment({
        orderId: placed.orderId,
        ref: placed.ref,
        amountPaise: placed.totalPaise,
        currency: "INR",
        email: placed.email,
        phone: placed.phone,
        customerName: address.name ?? "",
        expiresAt: outcome.order.expiresAt,
      });
    } catch {
      result = { ok: false as const, message: "We couldn't start the payment. Please try again." };
    }
    if (!result.ok) {
      if (outcome.kind === "created") {
        await expireOrder(db, placed.orderId, { now, reason: "payment_init_failed" });
      }
      return {
        ok: false,
        error: {
          code: "payment_init_failed",
          message: result.message || "We couldn't start the payment. Please try again.",
        },
      };
    }
    payment = result.payload;
  }

  return {
    ok: true,
    replayed: outcome.kind === "replay",
    order: placed,
    payment,
    productIds: outcome.productIds,
  };
}

async function runOrderTransaction(
  tx: DbClient,
  cartId: string,
  form: ReturnType<typeof placeOrderSchema.parse>,
  input: CreateFromCartInput,
  now: Date,
): Promise<TxOutcome> {
  const fail = (error: OrderError): never => {
    throw new OrderCreationError(error);
  };

  // 1. Lock the cart (cart mutations lock the same row first), then read it.
  const [cart] = await tx.select().from(carts).where(eq(carts.id, cartId)).for("update");
  if (!cart) {
    return fail({ code: "cart_not_found", message: "We couldn't find your cart. Please refresh the page." });
  }
  const address = form.shippingAddress;
  const idempotencyKey = composeIdempotencyKey({
    cartId: cart.id,
    cartVersion: cart.version,
    clientKey: form.idempotencyKey,
    fingerprint: checkoutFingerprint({
      paymentMethod: form.paymentMethod,
      email: form.email,
      phone: form.phone,
      address,
    }),
  });

  // 2. Idempotency: a repeat submit returns the existing order.
  const [existing] = await tx.select().from(orders).where(eq(orders.idempotencyKey, idempotencyKey));
  if (existing) {
    if (existing.status === "expired" || existing.status === "cancelled") {
      return fail({
        code: "checkout_expired",
        message: "This checkout expired. Please review your cart and place the order again.",
      });
    }
    const token = await issueOrderAccessToken(tx, existing.id);
    return { kind: "replay", order: existing, token, productIds: [] };
  }

  const items = await tx
    .select({ variantId: cartItems.variantId, qty: cartItems.qty })
    .from(cartItems)
    .where(eq(cartItems.cartId, cart.id))
    .orderBy(asc(cartItems.variantId));
  if (items.length === 0) {
    return fail({ code: "empty_cart", message: "Your cart is empty. Add something first." });
  }

  // 3. Release this cart's earlier pending orders (locking them before the variants, the same
  //    order the payment finalisation uses: order row, then stock).
  const stale = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.cartId, cart.id), eq(orders.status, "pending_payment")))
    .orderBy(asc(orders.id));
  for (const s of stale) {
    await expireLocked(tx, s.id, { now, reason: "superseded", onlyIfDue: false });
  }

  // 4. Lock the variants in a deterministic order and recompute availability.
  const variantIds = items.map((i) => i.variantId);
  const [stockRows, snaps, settings] = await Promise.all([
    loadVariantStock(tx, variantIds, now, { lock: true }),
    loadVariantSnapshots(tx, variantIds),
    loadCommerceSettings(tx),
  ]);
  const stock = new Map(stockRows.map((s) => [s.variantId, s]));
  const maxPerLine = settings.inventory.maxQtyPerLine;

  const shortages: ShortageItem[] = [];
  for (const item of items) {
    const snap = snaps.get(item.variantId);
    const st = stock.get(item.variantId);
    if (!snap || !st || !snap.purchasable) {
      const name = snap ? displayName(snap) : "An item in your cart";
      shortages.push({
        variantId: item.variantId,
        name,
        requested: item.qty,
        available: 0,
        reason: "unavailable",
        message: `${name} is no longer available.`,
      });
    } else if (st.available <= 0) {
      const name = displayName(snap);
      shortages.push({
        variantId: item.variantId,
        name,
        requested: item.qty,
        available: 0,
        reason: "sold_out",
        message: `${name} just sold out.`,
      });
    } else if (item.qty > maxPerLine) {
      const name = displayName(snap);
      shortages.push({
        variantId: item.variantId,
        name,
        requested: item.qty,
        available: Math.min(st.available, maxPerLine),
        reason: "max_per_line",
        message: `You can buy up to ${maxPerLine} of ${name} per order.`,
      });
    } else if (item.qty > st.available) {
      const name = displayName(snap);
      shortages.push({
        variantId: item.variantId,
        name,
        requested: item.qty,
        available: st.available,
        reason: "insufficient",
        message: `Only ${st.available} left of ${name} (you have ${item.qty} in your cart).`,
      });
    }
  }
  if (shortages.length > 0) {
    return fail({
      code: "insufficient_stock",
      message: "Some items in your cart aren't available in the quantity you chose. Please review your cart.",
      items: shortages,
    });
  }

  // 5. Re-price and re-validate everything on the server.
  const lines = items.map((i) => toCartLine(snaps.get(i.variantId)!, i.qty, settings));
  const a = await assessCheckout(tx, {
    lines,
    couponCode: cart.couponCode,
    email: form.email,
    pincode: address.pincode,
    paymentMethod: form.paymentMethod,
    settings,
    now,
    lockCoupon: true,
  });
  if (!a.serviceability.serviceable) {
    return fail({ code: "not_serviceable", message: a.serviceability.message });
  }
  if (form.paymentMethod === "cod" && !a.cod.eligible) {
    return fail({ code: "cod_unavailable", message: a.cod.reason });
  }
  if (a.quote.coupon && !a.quote.coupon.applied) {
    return fail({
      code: "coupon_invalid",
      message: `${a.quote.coupon.message ?? "That code can't be used on this order."} Remove the code to continue.`,
    });
  }
  const price = a.quote.price;
  // Razorpay's minimum charge is ₹1; a free order has nothing to collect.
  if (price.totalPaise <= 0 || (form.paymentMethod === "razorpay" && price.totalPaise < 100)) {
    return fail({
      code: "invalid_total",
      message: "This order total can't be processed online. Please contact us and we'll help.",
    });
  }
  const info = a.pincode!; // serviceable implies the directory row exists

  // 6. Insert the order.
  const isCod = form.paymentMethod === "cod";
  const expiresAt = isCod ? null : new Date(now.getTime() + settings.inventory.reservationTtlMinutes * 60_000);
  const { token, hash } = createAccessToken();
  const [vibeAtOrder, policyAckVersion] = await Promise.all([
    resolveVibeSlug(tx, form.vibe),
    currentPolicyVersions(tx),
  ]);
  const shippingAddress = {
    name: address.name,
    phone: form.phone,
    line1: address.line1,
    line2: address.line2 ?? null,
    landmark: address.landmark ?? null,
    city: address.city,
    // The directory is authoritative for the state (it decides CGST/SGST versus IGST).
    state: info.stateName,
    stateCode: info.stateCode,
    pincode: address.pincode,
    country: "IN",
  };

  let order: OrderRow | undefined;
  for (let attempt = 0; attempt < 8 && !order; attempt++) {
    [order] = await tx
      .insert(orders)
      .values({
        ref: generateOrderRef(now),
        userId: input.userId ?? null,
        cartId: cart.id,
        email: form.email,
        phone: form.phone,
        status: isCod ? "confirmed" : "pending_payment",
        paymentStatus: isCod ? "cod_pending" : "unpaid",
        fulfillmentStatus: "unfulfilled",
        paymentMethod: form.paymentMethod,
        subtotalPaise: price.subtotalPaise,
        discountPaise: price.discountPaise,
        shippingPaise: price.shippingPaise,
        codFeePaise: price.codFeePaise,
        totalPaise: price.totalPaise,
        taxIncludedPaise: price.taxIncludedPaise,
        couponCode: price.appliedCouponCode,
        shippingAddress,
        vibeAtOrder,
        accessTokenHash: hash,
        idempotencyKey,
        policyAckVersion,
        placedAt: now,
        expiresAt,
      })
      .onConflictDoNothing({ target: orders.ref })
      .returning();
  }
  if (!order) throw new Error("Could not allocate a unique order reference");

  await tx.insert(orderItems).values(
    price.lines.map((l) => {
      const snap = snaps.get(l.variantId)!;
      return {
        orderId: order!.id,
        variantId: l.variantId,
        productId: snap.productId,
        productName: snap.productName,
        variantTitle: snap.variantTitle,
        sku: snap.sku,
        imagePath: snap.image?.path ?? null,
        unitPricePaise: l.unitPricePaise,
        mrpPaise: l.mrpPaise,
        qty: l.qty,
        discountAllocPaise: l.discountAllocPaise,
        lineTotalPaise: l.lineTotalPaise,
        hsn: snap.hsn,
        gstRateBp: l.gstRateBp,
        taxPaise: l.taxPaise,
      };
    }),
  );

  await addEvent(tx, order.id, {
    type: "order_placed",
    to: order.status,
    note: isCod ? "Order placed. Pay cash on delivery." : "Order placed. Waiting for payment.",
    visible: true,
  });

  // 7. Stock: reserve (prepaid) or decrement through the ledger (COD).
  if (isCod) {
    try {
      for (const l of price.lines) {
        await adjustStock(
          { variantId: l.variantId, delta: -l.qty, reason: "sale", actorId: null, orderId: order.id },
          tx,
        );
      }
    } catch (e) {
      if (e instanceof InsufficientStockError) {
        const name = displayName(snaps.get(e.variantId)!);
        return fail({
          code: "insufficient_stock",
          message: "Some items in your cart aren't available in the quantity you chose.",
          items: [
            {
              variantId: e.variantId,
              name,
              requested: -e.delta,
              available: e.onHand,
              reason: e.onHand === 0 ? "sold_out" : "insufficient",
              message: `Only ${e.onHand} left of ${name}.`,
            },
          ],
        });
      }
      throw e;
    }
    await addEvent(tx, order.id, { type: "stock_decremented", note: "Stock sold (cash on delivery)." });
  } else {
    await tx.insert(stockReservations).values(
      price.lines.map((l) => ({
        orderId: order!.id,
        variantId: l.variantId,
        qty: l.qty,
        expiresAt: expiresAt!,
        status: "active" as const,
      })),
    );
    await addEvent(tx, order.id, {
      type: "stock_reserved",
      note: `Stock reserved until ${expiresAt!.toISOString()}.`,
    });
  }

  // 8. Coupon redemption: reserved now, confirmed straight away for COD (plan 7.3).
  if (a.quote.appliedCoupon) {
    await reserveRedemption(tx, {
      couponId: a.quote.appliedCoupon.couponId,
      orderId: order.id,
      email: form.email,
    });
    if (isCod) await confirmRedemption(tx, order.id);
    await addEvent(tx, order.id, {
      type: isCod ? "coupon_confirmed" : "coupon_reserved",
      note: a.quote.appliedCoupon.code,
    });
  }

  // 9. COD is final: empty the cart. Prepaid keeps it until the payment is captured. The version
  //    is deliberately NOT bumped here, so a retry of this same submit (lost response, double
  //    click) still matches the idempotency key and gets the order back instead of "empty cart".
  if (isCod) {
    await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));
    await tx.update(carts).set({ couponCode: null }).where(eq(carts.id, cart.id));
  }

  if (input.hooks?.onPlacedInTransaction) {
    await input.hooks.onPlacedInTransaction(tx, toPlacedOrder(order, token));
  }

  return {
    kind: "created",
    order,
    token,
    productIds: [...new Set(price.lines.map((l) => snaps.get(l.variantId)!.productId))],
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Customer order lookup                                                                      */
/* ------------------------------------------------------------------------------------------ */

export interface CustomerOrderItem {
  productName: string;
  variantTitle: string;
  sku: string;
  imagePath: string | null;
  qty: number;
  unitPricePaise: number;
  mrpPaise: number;
  discountAllocPaise: number;
  lineTotalPaise: number;
  gstRateBp: number | null;
  taxPaise: number;
}

export interface CustomerOrderView {
  id: string;
  ref: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  /** Single customer-facing label (domain `customerStatusLabel`). */
  statusLabel: CustomerStatusLabel;
  paymentMethod: PaymentMethod;
  email: string;
  phone: string | null;
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
  taxIncludedPaise: number;
  couponCode: string | null;
  shippingAddress: Record<string, unknown>;
  placedAt: Date;
  paidAt: Date | null;
  expiresAt: Date | null;
  items: CustomerOrderItem[];
  /** Timeline, customer-visible events only. */
  events: { type: string; note: string | null; createdAt: Date }[];
}

/** Equal-cost dummy so an unknown ref and a wrong token take the same time. */
const DUMMY_HASH = hashAccessToken("ifonli-no-such-order");

/**
 * Order page data for a guest holding the `?t=` link (plan 7.11): the order is returned only when
 * the token's SHA-256 matches the stored hash (constant-time). Unknown ref, missing token and wrong
 * token are all `null`, indistinguishable to the caller.
 */
export async function getOrderForCustomer(
  db: DbClient,
  ref: string,
  token: string,
): Promise<CustomerOrderView | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.ref, normalizeOrderRef(ref)))
    .limit(1);
  const ok = verifyAccessToken(token ?? "", order?.accessTokenHash ?? DUMMY_HASH);
  if (!order || !order.accessTokenHash || !ok) return null;

  const [items, events] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.createdAt), asc(orderItems.id)),
    db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.visibleToCustomer, true)))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id)),
  ]);
  return {
    id: order.id,
    ref: order.ref,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    statusLabel: customerStatusLabel(order),
    paymentMethod: order.paymentMethod,
    email: order.email,
    phone: order.phone,
    subtotalPaise: order.subtotalPaise,
    discountPaise: order.discountPaise,
    shippingPaise: order.shippingPaise,
    codFeePaise: order.codFeePaise,
    totalPaise: order.totalPaise,
    taxIncludedPaise: order.taxIncludedPaise,
    couponCode: order.couponCode,
    shippingAddress: (order.shippingAddress ?? {}) as Record<string, unknown>,
    placedAt: order.placedAt,
    paidAt: order.paidAt,
    expiresAt: order.expiresAt,
    items: items.map((i) => ({
      productName: i.productName,
      variantTitle: i.variantTitle,
      sku: i.sku,
      imagePath: i.imagePath,
      qty: i.qty,
      unitPricePaise: i.unitPricePaise,
      mrpPaise: i.mrpPaise,
      discountAllocPaise: i.discountAllocPaise,
      lineTotalPaise: i.lineTotalPaise,
      gstRateBp: i.gstRateBp,
      taxPaise: i.taxPaise,
    })),
    events: events.map((e) => ({ type: e.type, note: e.note, createdAt: e.createdAt })),
  };
}

export type { CheckoutFormValues };
