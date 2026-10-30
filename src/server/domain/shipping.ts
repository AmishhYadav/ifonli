/** COD eligibility (plan 7.9) and delivery estimates. Pure. */

import { formatINR } from "@/lib/money";

import { istParts } from "./ist";

export type CodIneligibleCode =
  "cod_disabled" | "pincode_not_allowed" | "excluded_items" | "over_max_value";

export interface CodEligibilityInput {
  codEnabled: boolean;
  pincodeCodAllowed: boolean;
  orderTotalPaise: number;
  /** null = no cap. */
  codMaxOrderValuePaise: number | null;
  hasExcludedItems: boolean;
}

export type CodEligibility =
  { eligible: true } | { eligible: false; code: CodIneligibleCode; reason: string };

/** Checks run in order: setting, pincode, excluded items, order value (`total <= max` is allowed). */
export function codEligibility(input: CodEligibilityInput): CodEligibility {
  if (!input.codEnabled) {
    return {
      eligible: false,
      code: "cod_disabled",
      reason: "Cash on delivery isn't available right now.",
    };
  }
  if (!input.pincodeCodAllowed) {
    return {
      eligible: false,
      code: "pincode_not_allowed",
      reason: "Cash on delivery isn't available for this pincode. You can pay online instead.",
    };
  }
  if (input.hasExcludedItems) {
    return {
      eligible: false,
      code: "excluded_items",
      reason: "Some items in your cart can only be paid for online.",
    };
  }
  if (input.codMaxOrderValuePaise !== null && input.orderTotalPaise > input.codMaxOrderValuePaise) {
    return {
      eligible: false,
      code: "over_max_value",
      reason: `Cash on delivery is available for orders up to ${formatINR(input.codMaxOrderValuePaise)}.`,
    };
  }
  return { eligible: true };
}

export interface DeliveryEstimateInput {
  /** Working days to pack and hand over to the courier. */
  processingDays: number;
  /** Transit range for the destination zone, in working days. */
  zoneRange: { minDays: number; maxDays: number };
  now: Date;
}

export interface DeliveryEstimate {
  /** Earliest expected delivery date, "YYYY-MM-DD" (India calendar). */
  fromDate: string;
  /** Latest expected delivery date, "YYYY-MM-DD" (India calendar). */
  toDate: string;
}

const DAY_MS = 86_400_000;

function assertDays(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Add `days` working days to a day number (days since epoch of an India calendar date).
 * Sundays are not working days: they are skipped, and a result is never a Sunday
 * (0 days on a Sunday rolls forward to Monday). Saturdays count as working days.
 */
function addWorkingDays(dayNumber: number, days: number): number {
  let d = dayNumber;
  let remaining = days;
  while (remaining > 0) {
    d += 1;
    if (new Date(d * DAY_MS).getUTCDay() !== 0) {
      remaining -= 1;
    }
  }
  if (new Date(d * DAY_MS).getUTCDay() === 0) {
    d += 1;
  }
  return d;
}

function dayNumberToString(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Delivery window = today (India date) + processingDays + zone transit days, in working days,
 * skipping Sundays. Dates are India calendar dates as "YYYY-MM-DD".
 */
export function deliveryEstimate(input: DeliveryEstimateInput): DeliveryEstimate {
  const { processingDays, zoneRange, now } = input;
  assertDays(processingDays, "processingDays");
  assertDays(zoneRange.minDays, "zoneRange.minDays");
  assertDays(zoneRange.maxDays, "zoneRange.maxDays");
  if (zoneRange.maxDays < zoneRange.minDays) {
    throw new RangeError("zoneRange.maxDays must be >= zoneRange.minDays");
  }
  const p = istParts(now);
  const today = Date.UTC(p.year, p.month - 1, p.day) / DAY_MS;
  return {
    fromDate: dayNumberToString(addWorkingDays(today, processingDays + zoneRange.minDays)),
    toDate: dayNumberToString(addWorkingDays(today, processingDays + zoneRange.maxDays)),
  };
}
