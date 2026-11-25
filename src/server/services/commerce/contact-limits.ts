import "server-only";

import {
  consumeRateLimit,
  digestKey,
  releaseRateLimit,
  type RateLimitRule,
} from "../rate-limit";
import type { DbClient } from "../queries/shared";

/**
 * Per-contact order budgets. Checkout is also limited per IP and per cart, but both are cheap to
 * rotate, and a cash-on-delivery order takes stock immediately (prepaid orders reserve it), so
 * someone could empty the shop with junk orders. The order contacts are the one thing a fake order
 * still has to carry and cannot rotate for free, so each normalised e-mail and each normalised phone
 * gets its own daily budget: at most `ORDERS_PER_DAY` new orders (any payment method) and at most
 * `COD_ORDERS_PER_DAY` of them cash on delivery.
 *
 * Keys are digests (never the raw e-mail or number). The window is a fixed 24 h one (UTC days, so it
 * resets at 05:30 IST), like every other `rate_limits` budget.
 */

export const ORDERS_PER_DAY = 5;
export const COD_ORDERS_PER_DAY = 3;
const WINDOW_SECONDS = 24 * 60 * 60;

const ALL_RULE: RateLimitRule = { limit: ORDERS_PER_DAY, windowSeconds: WINDOW_SECONDS };
const COD_RULE: RateLimitRule = { limit: COD_ORDERS_PER_DAY, windowSeconds: WINDOW_SECONDS };

/** What the customer sees when a budget is used up (calm: it may be a genuine repeat customer). */
export const CONTACT_LIMIT_MESSAGE =
  "We've received several orders with these details today. Please try again tomorrow or contact us.";

export interface ContactBudget {
  key: string;
  rule: RateLimitRule;
}

/**
 * The budgets one new order counts against, in a FIXED order (sorted by key). The order matters:
 * the counters are row-locked until the order transaction ends, so two checkouts that share a
 * contact must always take the rows in the same sequence or they could deadlock.
 *
 * `email` must already be normalised the way the checkout schema does (trimmed, lower-cased) and
 * `phone` as `+91XXXXXXXXXX`.
 */
export function contactBudgets(contact: {
  email: string;
  phone: string;
  paymentMethod: "razorpay" | "cod";
}): ContactBudget[] {
  const who = [
    { kind: "email", digest: digestKey(contact.email.trim().toLowerCase()) },
    { kind: "phone", digest: digestKey(contact.phone) },
  ];
  const budgets: ContactBudget[] = [];
  for (const { kind, digest } of who) {
    budgets.push({ key: `order:${kind}:${digest}`, rule: ALL_RULE });
    if (contact.paymentMethod === "cod") {
      budgets.push({ key: `order-cod:${kind}:${digest}`, rule: COD_RULE });
    }
  }
  return budgets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * True when the budgets are switched off: ONLY for the functional e2e run (`next dev` with the
 * mock checkout, which places many orders with one test contact). A production build can never
 * relax them, whatever the other variable says.
 */
export function contactLimitsRelaxed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && env.E2E_MOCK_CHECKOUT === "1";
}

export type ContactLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Counts one new order against the contact's budgets. Call it INSIDE the order transaction with the
 * transaction handle, after the idempotency replay check and before the insert:
 *  - a refusal (or any later failure that rolls the transaction back: stock, coupon, ...) leaves the
 *    counters untouched, so only orders that are really created use up budget;
 *  - the counters are upserted atomically, so parallel submits cannot slip past the limit.
 */
export async function consumeContactOrderBudget(
  tx: DbClient,
  contact: { email: string; phone: string; paymentMethod: "razorpay" | "cod" },
  now: Date,
): Promise<ContactLimitDecision> {
  let retryAfterSeconds = 0;
  let allowed = true;
  for (const { key, rule } of contactBudgets(contact)) {
    const decision = await consumeRateLimit(tx, key, rule, now);
    if (!decision.allowed) {
      allowed = false;
      retryAfterSeconds = Math.max(retryAfterSeconds, decision.retryAfterSeconds);
    }
  }
  return allowed ? { allowed: true } : { allowed: false, retryAfterSeconds };
}

/**
 * Gives the budget back for an order that was created but never took anything: its payment could
 * not be started (the provider was down), so the order was expired at once. Without this, a payment
 * outage would burn a genuine customer's day of orders. Pass the same `now` the order was created at.
 */
export async function releaseContactOrderBudget(
  db: DbClient,
  contact: { email: string; phone: string; paymentMethod: "razorpay" | "cod" },
  now: Date,
): Promise<void> {
  for (const { key, rule } of contactBudgets(contact)) {
    await releaseRateLimit(db, key, rule, now);
  }
}
