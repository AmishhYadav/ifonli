import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { couponRedemptions, coupons } from "@/server/db/schema";
import {
  normalizeCode,
  validateCoupon as validateCouponRecord,
  type AppliedCoupon,
  type CartLine,
  type CouponRecord,
  type CouponRejectCode,
} from "@/server/domain";

import type { DbClient } from "./queries/shared";

/** Domain reject codes plus the two failures that only exist at the DB layer. */
export type CouponErrorCode = CouponRejectCode | "empty" | "not_found";

export type CouponCheck =
  { ok: true; applied: AppliedCoupon } | { ok: false; code: CouponErrorCode; message: string };

const scopeSchema = z
  .object({
    vibes: z.array(z.string()).optional(),
    types: z.array(z.string()).optional(),
    products: z.array(z.string()).optional(),
    excludeProducts: z.array(z.string()).optional(),
  })
  .catch({});

export const REDEMPTION_COUNTING = ["reserved", "confirmed"] as const;

function toRecord(row: typeof coupons.$inferSelect): CouponRecord {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: row.value,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    // The column is NOT NULL DEFAULT 0; 0 means "no minimum".
    minSubtotalPaise: row.minSubtotalPaise > 0 ? row.minSubtotalPaise : null,
    maxDiscountPaise: row.maxDiscountPaise,
    usageLimit: row.usageLimit,
    perCustomerLimit: row.perCustomerLimit,
    scope: scopeSchema.parse(row.scope),
    active: row.active,
  };
}

export interface ValidateCouponOptions {
  now?: Date;
  /** Code already on the cart: a different one is rejected as stacking (v1: one coupon per order). */
  alreadyAppliedCode?: string | null;
  /**
   * Row-lock the coupon (`FOR UPDATE`) so that counting redemptions and inserting the reserved one
   * is atomic. Only meaningful inside the order-creation transaction.
   */
  lock?: boolean;
}

/**
 * Validates a code against a cart: the domain rules (active, dates, usage limits, scope, min
 * subtotal, stacking) with the coupon row and the redemption counts (`reserved` + `confirmed`)
 * loaded from the database. `email` enables the per-customer limit; without one (a cart before
 * checkout) that limit cannot be checked yet and is enforced again when the order is created.
 * Errors are specific and human (plan 7.3).
 */
export async function validateCoupon(
  db: DbClient,
  code: string,
  lines: readonly CartLine[],
  email?: string | null,
  opts: ValidateCouponOptions = {},
): Promise<CouponCheck> {
  const normalized = normalizeCode(code);
  if (normalized.length === 0) {
    return { ok: false, code: "empty", message: "Enter a coupon code." };
  }
  if (normalized.length > 64) {
    return { ok: false, code: "not_found", message: `We couldn't find the code ${normalized.slice(0, 20)}…` };
  }

  const base = db
    .select()
    .from(coupons)
    .where(sql`lower(${coupons.code}) = lower(${normalized})`)
    .limit(1);
  const [row] = opts.lock ? await base.for("update") : await base;
  if (!row) {
    return {
      ok: false,
      code: "not_found",
      message: `We couldn't find the code ${normalized}. Check the spelling and try again.`,
    };
  }

  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(couponRedemptions)
    .where(
      and(
        eq(couponRedemptions.couponId, row.id),
        inArray(couponRedemptions.status, [...REDEMPTION_COUNTING]),
      ),
    );
  let byEmail = 0;
  const cleanEmail = email?.trim();
  if (cleanEmail) {
    const [mine] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.couponId, row.id),
          inArray(couponRedemptions.status, [...REDEMPTION_COUNTING]),
          sql`lower(${couponRedemptions.email}) = lower(${cleanEmail})`,
        ),
      );
    byEmail = mine?.n ?? 0;
  }

  const result = validateCouponRecord(toRecord(row), {
    now: opts.now ?? new Date(),
    lines,
    totalRedemptions: total?.n ?? 0,
    redemptionsByThisEmail: byEmail,
    alreadyAppliedCode: opts.alreadyAppliedCode ?? null,
  });
  return result.ok
    ? { ok: true, applied: result.applied }
    : { ok: false, code: result.code, message: result.message };
}

/** Records a `reserved` redemption for the order (idempotent per coupon + order). */
export async function reserveRedemption(
  db: DbClient,
  input: { couponId: string; orderId: string; email: string },
): Promise<void> {
  await db
    .insert(couponRedemptions)
    .values({ couponId: input.couponId, orderId: input.orderId, email: input.email, status: "reserved" })
    .onConflictDoNothing({ target: [couponRedemptions.couponId, couponRedemptions.orderId] });
}

/** `reserved` -> `confirmed` on payment capture or COD placement. Returns rows changed. */
export async function confirmRedemption(db: DbClient, orderId: string): Promise<number> {
  const rows = await db
    .update(couponRedemptions)
    .set({ status: "confirmed" })
    .where(and(eq(couponRedemptions.orderId, orderId), eq(couponRedemptions.status, "reserved")))
    .returning({ id: couponRedemptions.id });
  return rows.length;
}

/** Frees the redemption on expiry or cancellation (`reserved` or `confirmed` -> `released`). */
export async function releaseRedemption(db: DbClient, orderId: string): Promise<number> {
  const rows = await db
    .update(couponRedemptions)
    .set({ status: "released" })
    .where(
      and(
        eq(couponRedemptions.orderId, orderId),
        inArray(couponRedemptions.status, [...REDEMPTION_COUNTING]),
      ),
    )
    .returning({ id: couponRedemptions.id });
  return rows.length;
}
