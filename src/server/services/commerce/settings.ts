import { ilike } from "drizzle-orm";

import { states } from "@/server/db/schema";
import type { ShippingTaxRule } from "@/server/domain";

import { readSettings, type DbClient } from "../queries/shared";
import type { SettingValue } from "../settings-registry";

/** The business-rule settings the commerce flows (cart, quote, checkout, order creation) read. */
export interface CommerceSettings {
  shipping: {
    flatFeePaise: number;
    /** 0 = always free (domain: `subtotal - discount >= 0`). */
    freeThresholdPaise: number;
    /** Delivery pincodes that always ship free. */
    freePincodes: readonly string[];
    zoneFeeOverridesPaise: Partial<Record<string, number>>;
    serviceabilityMode: SettingValue<"serviceability_mode">;
    processingDays: number;
    deliveryEstimatesByZone: SettingValue<"delivery_estimates_by_zone">;
  };
  cod: {
    enabled: boolean;
    feePaise: number;
    /** 0 = no COD (domain compares `total > max`). */
    maxOrderValuePaise: number;
    excludedPincodes: readonly string[];
  };
  tax: {
    defaultGstRateBp: number;
    shippingTaxRule: ShippingTaxRule;
    /** 2-digit GST code of the store state, "00" while the setting is unset / not a known state. */
    sellerStateCode: string;
  };
  inventory: {
    maxQtyPerLine: number;
    reservationTtlMinutes: number;
    defaultLowStockThreshold: number;
  };
}

/** Unknown seller state: any buyer state differs, so tax is reported as IGST (never throws). */
export const UNKNOWN_STATE_CODE = "00";

/** One round trip for every setting commerce needs, plus the seller state-name -> code lookup. */
export async function loadCommerceSettings(db: DbClient): Promise<CommerceSettings> {
  const s = await readSettings(db, [
    "flat_fee",
    "free_threshold",
    "free_shipping_pincodes",
    "zone_overrides",
    "serviceability_mode",
    "processing_days",
    "delivery_estimates_by_zone",
    "cod_enabled",
    "cod_fee",
    "cod_max_order_value",
    "cod_excluded_pincodes",
    "default_gst_rate_bp",
    "shipping_tax_rule",
    "state",
    "max_qty_per_line",
    "reservation_ttl_minutes",
    "default_low_stock_threshold",
  ] as const);

  const defaultGstRateBp = s.default_gst_rate_bp.value;
  const rule = s.shipping_tax_rule.value;
  const shippingTaxRule: ShippingTaxRule =
    rule === "dominant_line_rate"
      ? { kind: "dominant_line_rate" }
      : rule === "exempt"
        ? { kind: "fixed", rateBp: 0 }
        : { kind: "fixed", rateBp: defaultGstRateBp };

  const [stateRow] = await db
    .select({ code: states.code })
    .from(states)
    // ilike without wildcards = case-insensitive equality; LIKE metacharacters are escaped.
    .where(ilike(states.name, s.state.value.replace(/[\\%_]/g, "\\$&")))
    .limit(1);

  return {
    shipping: {
      flatFeePaise: s.flat_fee.value,
      freeThresholdPaise: s.free_threshold.value,
      freePincodes: s.free_shipping_pincodes.value,
      zoneFeeOverridesPaise: s.zone_overrides.value,
      serviceabilityMode: s.serviceability_mode.value,
      processingDays: s.processing_days.value,
      deliveryEstimatesByZone: s.delivery_estimates_by_zone.value,
    },
    cod: {
      enabled: s.cod_enabled.value,
      feePaise: s.cod_fee.value,
      maxOrderValuePaise: s.cod_max_order_value.value,
      excludedPincodes: s.cod_excluded_pincodes.value,
    },
    tax: { defaultGstRateBp, shippingTaxRule, sellerStateCode: stateRow?.code ?? UNKNOWN_STATE_CODE },
    inventory: {
      maxQtyPerLine: s.max_qty_per_line.value,
      reservationTtlMinutes: s.reservation_ttl_minutes.value,
      defaultLowStockThreshold: s.default_low_stock_threshold.value,
    },
  };
}
