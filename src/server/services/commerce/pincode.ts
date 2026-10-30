import { eq } from "drizzle-orm";

import { pincodes, states } from "@/server/db/schema";
import { codEligibility, deliveryEstimate, type CodEligibility, type DeliveryEstimate } from "@/server/domain";

import type { DbClient } from "../queries/shared";
import type { PincodeInfo } from "../reference";
import type { CommerceSettings } from "./settings";

export type { PincodeInfo };

export const PINCODE_RE = /^[1-9][0-9]{5}$/;

/** Pincode directory row with its state (checkout autofill, serviceability, COD, zone, GST state). */
export async function lookupPincodeInfo(db: DbClient, pincode: string): Promise<PincodeInfo | null> {
  if (!PINCODE_RE.test(pincode)) return null;
  const [row] = await db
    .select({
      pincode: pincodes.pincode,
      district: pincodes.district,
      stateCode: pincodes.stateCode,
      stateName: states.name,
      zone: pincodes.zone,
      serviceable: pincodes.serviceable,
      codAllowed: pincodes.codAllowed,
    })
    .from(pincodes)
    .innerJoin(states, eq(states.code, pincodes.stateCode))
    .where(eq(pincodes.pincode, pincode))
    .limit(1);
  return row ?? null;
}

export type Serviceability =
  | { serviceable: true }
  | { serviceable: false; code: "invalid_pincode" | "unknown_pincode" | "not_serviceable"; message: string };

/**
 * Can we deliver to this pincode? The directory's `serviceable` flag is the managed list for every
 * `serviceability_mode`: `all_india` = every pincode left serviceable, `allowlist` = only the ones
 * an admin marked serviceable, `denylist` = all except the ones marked unserviceable. There is no
 * separate list table, so the three modes read the same flag. A pincode that is not in the
 * directory is never serviceable (we could not work out the GST state or zone for it).
 */
export function checkServiceability(input: string, info: PincodeInfo | null): Serviceability {
  if (!PINCODE_RE.test(input)) {
    return { serviceable: false, code: "invalid_pincode", message: "Enter a valid 6-digit pincode." };
  }
  if (!info) {
    return {
      serviceable: false,
      code: "unknown_pincode",
      message: "We couldn't find that pincode. Please check it and try again.",
    };
  }
  if (!info.serviceable) {
    return {
      serviceable: false,
      code: "not_serviceable",
      message: `Sorry, we can't deliver to ${info.pincode} yet.`,
    };
  }
  return { serviceable: true };
}

/**
 * COD eligibility (plan 7.9). `orderTotalPaise` is the total BEFORE the COD fee (goods + shipping
 * after discount), so the fee itself can never push an order over the cap. The pincode must allow
 * COD in the directory and must not be in the `cod_excluded_pincodes` setting. The schema has no
 * per-product COD flag, so there are never "excluded items".
 */
export function evaluateCod(
  settings: CommerceSettings,
  info: PincodeInfo | null,
  orderTotalPaise: number,
): CodEligibility {
  const pincodeCodAllowed =
    info !== null && info.codAllowed && !settings.cod.excludedPincodes.includes(info.pincode);
  return codEligibility({
    codEnabled: settings.cod.enabled,
    pincodeCodAllowed,
    orderTotalPaise,
    codMaxOrderValuePaise: settings.cod.maxOrderValuePaise,
    hasExcludedItems: false,
  });
}

/** Delivery window for the pincode's zone, or null when no transit range is configured for it. */
export function estimateDelivery(
  settings: CommerceSettings,
  info: PincodeInfo | null,
  now: Date,
): DeliveryEstimate | null {
  const zone = info?.zone;
  if (!zone) return null;
  const range = settings.shipping.deliveryEstimatesByZone[zone as keyof typeof settings.shipping.deliveryEstimatesByZone];
  if (!range) return null;
  return deliveryEstimate({
    processingDays: settings.shipping.processingDays,
    zoneRange: range,
    now,
  });
}
