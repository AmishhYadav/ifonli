"use server";

import { unstable_rethrow } from "next/navigation";

import { lookupPincode } from "@/features/checkout/actions";
import type { ActionResult } from "@/features/cart/types";
import { getDb } from "@/server/db";
import { estimateDelivery, lookupPincodeInfo } from "@/server/services/commerce/pincode";
import { loadCommerceSettings } from "@/server/services/commerce/settings";

export interface DeliveryCheck {
  pincode: string;
  serviceable: boolean;
  /** Human text when not serviceable. */
  message: string | null;
  city: string | null;
  state: string | null;
  /** Cash on delivery is possible for this pincode (order value limits are checked at checkout). */
  codAllowed: boolean;
  /** Largest order value COD accepts, in paise (0 = COD off). */
  codMaxOrderPaise: number;
  /** India calendar dates "YYYY-MM-DD", or null when no estimate is configured for the zone. */
  delivery: { fromDate: string; toDate: string } | null;
}

/** PDP delivery check: serviceability, COD and the estimated delivery window for a pincode (no cart needed). */
export async function checkDelivery(input: { pincode: string }): Promise<ActionResult<DeliveryCheck>> {
  const lookup = await lookupPincode({ pincode: input.pincode });
  if (!lookup.ok) return lookup;
  const l = lookup.data;
  try {
    const db = getDb();
    const settings = await loadCommerceSettings(db);
    const info = l.serviceable ? await lookupPincodeInfo(db, l.pincode) : null;
    return {
      ok: true,
      data: {
        pincode: l.pincode,
        serviceable: l.serviceable,
        message: l.message,
        city: l.city,
        state: l.state,
        codAllowed: l.serviceable && l.codAllowed && settings.cod.enabled && settings.cod.maxOrderValuePaise > 0,
        codMaxOrderPaise: settings.cod.enabled ? settings.cod.maxOrderValuePaise : 0,
        delivery: info ? estimateDelivery(settings, info, new Date()) : null,
      },
    };
  } catch (e) {
    unstable_rethrow(e);
    console.error("checkDelivery failed", e);
    return {
      ok: false,
      error: { code: "server_error", message: "Something went wrong on our side. Please try again." },
    };
  }
}
