import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/server/db";
import { orders, payments } from "@/server/db/schema";
import { normalizeOrderRef, hashAccessToken } from "@/server/domain";
import { orderTokenMatches } from "@/server/services/commerce/order-token";
import { dispositionOf } from "@/server/services/refunds";
import type {
  PaymentInitContext,
  PaymentInitResult,
  PaymentInitiator,
  RazorpayCheckoutPayload,
} from "@/server/services/commerce/payment-hook";
import { readSettings, type DbClient } from "@/server/services/queries/shared";

import { PaymentConfigError, PaymentProviderError, type PaymentProvider } from "./provider";
import { getPaymentProvider } from "./registry";

/**
 * Creates (or re-opens) the provider order for a prepaid order and returns the Checkout.js payload.
 *
 * Idempotent per order: `createFromCart` calls it again for replayed submits and `retryPayment`
 * calls it for a retry, so an existing `payments` row with the same amount whose attempt has not
 * been captured is reused and no second provider order is created. An advisory transaction lock on
 * the order id stops two simultaneous calls from each creating one. The provider call happens inside
 * that short transaction (no row locks are held, so nothing else waits on it).
 */
export async function initiateOrderPayment(
  ctx: PaymentInitContext,
  deps: { db?: DbClient; provider?: PaymentProvider } = {},
): Promise<PaymentInitResult> {
  const db = deps.db ?? getDb();
  let provider: PaymentProvider;
  try {
    provider = deps.provider ?? getPaymentProvider();
  } catch (e) {
    if (e instanceof PaymentConfigError) {
      console.error("payments not configured:", e.message);
      return { ok: false, message: "Online payment is not available right now. Please try again later.", retryable: false };
    }
    throw e;
  }

  let providerOrderId: string;
  try {
    providerOrderId = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"pay:" + ctx.orderId}))`);
      const rows = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, ctx.orderId), inArray(payments.status, ["created", "authorized", "failed"])))
        .orderBy(desc(payments.createdAt));
      const reusable = rows.find((r) => r.amountPaise === ctx.amountPaise && !dispositionOf(r));
      if (reusable) return reusable.providerOrderId;

      const created = await provider.createOrder({
        amountPaise: ctx.amountPaise,
        receipt: ctx.ref,
        notes: { order_id: ctx.orderId, ref: ctx.ref },
      });
      await tx.insert(payments).values({
        orderId: ctx.orderId,
        provider: provider.name === "mock" ? "mock" : "razorpay",
        providerOrderId: created.id,
        amountPaise: ctx.amountPaise,
        status: "created",
      });
      return created.id;
    });
  } catch (e) {
    const retryable = e instanceof PaymentProviderError ? e.retryable : true;
    console.error("payment initiation failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: "We couldn't start the payment. Please try again.", retryable };
  }

  const { brand_name } = await readSettings(db, ["brand_name"]);
  const payload: RazorpayCheckoutPayload = {
    keyId: provider.keyId,
    razorpayOrderId: providerOrderId,
    amountPaise: ctx.amountPaise,
    currency: "INR",
    prefill: { name: ctx.customerName, email: ctx.email, contact: ctx.phone },
    name: brand_name.value,
    description: `Order ${ctx.ref}`,
    notes: { ref: ctx.ref },
    ...(provider.name === "mock" ? { mock: true } : {}),
  };
  return { ok: true, payload };
}

/** The `PaymentInitiator` handed to `createFromCart`. */
export const initiateRazorpayPayment: PaymentInitiator = (ctx) => initiateOrderPayment(ctx);

export type RetryPaymentResult =
  | { ok: true; payload: RazorpayCheckoutPayload; expiresAt: Date }
  | { ok: false; code: "not_found" | "not_retryable" | "expired" | "already_paid" | "payment_init_failed"; message: string };

const DUMMY_HASH = hashAccessToken("ifonli-no-such-order");

/**
 * Re-opens Checkout.js for the same provider order while the reservation is still valid (plan 7.6:
 * "Payment not completed - Retry"). Authorised by the guest access token (`?t=`), constant time.
 */
export async function retryOrderPayment(
  db: DbClient,
  input: { ref: string; token: string; now?: Date },
  deps: { provider?: PaymentProvider } = {},
): Promise<RetryPaymentResult> {
  const now = input.now ?? new Date();
  const [order] = await db.select().from(orders).where(eq(orders.ref, normalizeOrderRef(input.ref))).limit(1);
  const ok = orderTokenMatches(input.token ?? "", order?.accessTokenHash ?? DUMMY_HASH);
  if (!order || !order.accessTokenHash || !ok) {
    return { ok: false, code: "not_found", message: "We couldn't find that order." };
  }
  if (order.paidAt) {
    return { ok: false, code: "already_paid", message: "This order is already paid." };
  }
  if (order.paymentMethod !== "razorpay" || order.status !== "pending_payment") {
    return { ok: false, code: "not_retryable", message: "This order can't be paid any more. Please place it again." };
  }
  if (!order.expiresAt || order.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, code: "expired", message: "The payment window has ended. Please place the order again." };
  }

  const address = order.shippingAddress as { name?: string };
  const result = await initiateOrderPayment(
    {
      orderId: order.id,
      ref: order.ref,
      amountPaise: order.totalPaise,
      currency: "INR",
      email: order.email,
      phone: order.phone ?? "",
      customerName: address.name ?? "",
      expiresAt: order.expiresAt,
    },
    { db, provider: deps.provider },
  );
  if (!result.ok) return { ok: false, code: "payment_init_failed", message: result.message };

  if (order.paymentStatus === "failed") {
    // `failed -> unpaid` is a legal retry transition; the row lock is not needed for this flag.
    await db
      .update(orders)
      .set({ paymentStatus: "unpaid" })
      .where(and(eq(orders.id, order.id), eq(orders.paymentStatus, "failed"), eq(orders.status, "pending_payment")));
  }
  return { ok: true, payload: result.payload, expiresAt: order.expiresAt };
}
