import "server-only";

import { isInternalType, isRetiredType } from "./queries/storefront";
import { asc, eq, inArray } from "drizzle-orm";

import {
  productImages,
  productTypes,
  productVibes,
  products,
  variants,
  vibes,
} from "@/server/db/schema";
import {
  priceCart,
  type AppliedCoupon,
  type CartLine,
  type PaymentMethod,
  type PriceResult,
} from "@/server/domain";

import { validateCoupon, type CouponErrorCode } from "./coupons";
import { lookupPincodeInfo, type PincodeInfo } from "./commerce/pincode";
import { loadCommerceSettings, type CommerceSettings } from "./commerce/settings";
import type { DbClient } from "./queries/shared";

export { loadCommerceSettings, type CommerceSettings };

/** Why a variant cannot be bought right now (besides running out of stock). */
export type UnavailableReason = "variant_inactive" | "product_unavailable";

/** Catalogue facts about one variant, as the cart / checkout / order snapshots need them. */
export interface VariantSnapshot {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantTitle: string;
  sku: string;
  typeSlug: string;
  vibeSlugs: string[];
  pricePaise: number;
  mrpPaise: number;
  /** Product GST rate, or null = use the store default. */
  gstRateBp: number | null;
  hsn: string | null;
  /** Variant image, else the product's first photo, else its first cutout. */
  image: { path: string; alt: string } | null;
  purchasable: boolean;
  unavailableReason: UnavailableReason | null;
}

/**
 * Loads current catalogue data for variants (price, MRP, GST, names, image, vibes). Server prices
 * always come from here, never from the client. Unknown ids are absent from the map. Purchasable =
 * variant `active` AND product `active` AND its type `active` (the storefront visibility rule), or an internal type
 * (the DIY chain: bought only into a DIY pack, never listed).
 */
export async function loadVariantSnapshots(
  db: DbClient,
  variantIds: readonly string[],
): Promise<Map<string, VariantSnapshot>> {
  const out = new Map<string, VariantSnapshot>();
  if (variantIds.length === 0) return out;
  const ids = [...new Set(variantIds)];

  const rows = await db
    .select({
      variantId: variants.id,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      variantTitle: variants.title,
      sku: variants.sku,
      typeSlug: productTypes.slug,
      pricePaise: variants.pricePaise,
      mrpPaise: variants.mrpPaise,
      gstRateBp: products.gstRateBp,
      hsn: products.hsnCode,
      variantActive: variants.active,
      productStatus: products.status,
      typeActive: productTypes.active,
    })
    .from(variants)
    .innerJoin(products, eq(variants.productId, products.id))
    .innerJoin(productTypes, eq(products.typeId, productTypes.id))
    .where(inArray(variants.id, ids));
  if (rows.length === 0) return out;

  const productIds = [...new Set(rows.map((r) => r.productId))];
  const [imageRows, vibeRows] = await Promise.all([
    db
      .select({
        productId: productImages.productId,
        variantId: productImages.variantId,
        kind: productImages.kind,
        path: productImages.path,
        alt: productImages.alt,
      })
      .from(productImages)
      .where(inArray(productImages.productId, productIds))
      .orderBy(asc(productImages.position), asc(productImages.createdAt), asc(productImages.id)),
    db
      .select({ productId: productVibes.productId, slug: vibes.slug, sort: vibes.sort })
      .from(productVibes)
      .innerJoin(vibes, eq(productVibes.vibeId, vibes.id))
      .where(inArray(productVibes.productId, productIds))
      .orderBy(asc(vibes.sort), asc(vibes.slug)),
  ]);

  for (const r of rows) {
    const imgs = imageRows.filter((i) => i.productId === r.productId);
    const pick =
      imgs.find((i) => i.variantId === r.variantId) ??
      imgs.find((i) => i.variantId === null && i.kind === "photo") ??
      imgs.find((i) => i.variantId === null && i.kind === "cutout") ??
      imgs.find((i) => i.kind === "photo") ??
      imgs[0];
    const productOk =
      r.productStatus === "active" && (r.typeActive || isInternalType(r.typeSlug)) && !isRetiredType(r.typeSlug);
    out.set(r.variantId, {
      variantId: r.variantId,
      productId: r.productId,
      productSlug: r.productSlug,
      productName: r.productName,
      variantTitle: r.variantTitle,
      sku: r.sku,
      typeSlug: r.typeSlug,
      vibeSlugs: vibeRows.filter((v) => v.productId === r.productId).map((v) => v.slug),
      pricePaise: r.pricePaise,
      mrpPaise: r.mrpPaise,
      gstRateBp: r.gstRateBp,
      hsn: r.hsn,
      image: pick ? { path: pick.path, alt: pick.alt } : null,
      purchasable: r.variantActive && productOk,
      unavailableReason: !r.variantActive
        ? "variant_inactive"
        : !productOk
          ? "product_unavailable"
          : null,
    });
  }
  return out;
}

/** A priced-engine line (`lineId` = variant id; a cart holds one line per variant). */
export function toCartLine(
  snap: VariantSnapshot,
  qty: number,
  settings: Pick<CommerceSettings, "tax">,
): CartLine {
  return {
    lineId: snap.variantId,
    variantId: snap.variantId,
    productId: snap.productId,
    typeSlug: snap.typeSlug,
    vibeSlugs: snap.vibeSlugs,
    unitPricePaise: snap.pricePaise,
    mrpPaise: snap.mrpPaise,
    qty,
    gstRateBp: snap.gstRateBp ?? settings.tax.defaultGstRateBp,
  };
}

export interface QuoteRequest {
  lines: readonly CartLine[];
  couponCode?: string | null;
  /** Enables the per-customer coupon limit (known at checkout). */
  email?: string | null;
  /** 6-digit delivery pincode; drives zone fee overrides and the GST state. */
  pincode?: string | null;
  paymentMethod: PaymentMethod | null;
  /** Pass already-loaded values to avoid re-reading them (same transaction). */
  settings?: CommerceSettings;
  pincodeInfo?: PincodeInfo | null;
  now?: Date;
  /** Row-lock the coupon while validating (order creation only). */
  lockCoupon?: boolean;
}

export interface QuoteCoupon {
  code: string;
  applied: boolean;
  /** Why it is not applied (human), else null. */
  message: string | null;
  rejectCode: CouponErrorCode | null;
}

export interface Quote {
  price: PriceResult;
  coupon: QuoteCoupon | null;
  appliedCoupon: AppliedCoupon | null;
  pincode: PincodeInfo | null;
  settings: CommerceSettings;
}

/**
 * THE price calculation for cart, checkout and order creation (plan 7.1): loads the shipping / COD
 * / tax settings, validates the coupon against the lines, resolves the pincode's zone and GST
 * state, and runs the pure domain `priceCart`. The server result is the only truth. A coupon that
 * fails validation is not applied (the reason is reported in `coupon`); callers decide whether
 * that blocks the order.
 */
export async function quoteLines(db: DbClient, req: QuoteRequest): Promise<Quote> {
  const now = req.now ?? new Date();
  const settings = req.settings ?? (await loadCommerceSettings(db));
  const pincode =
    req.pincodeInfo !== undefined
      ? req.pincodeInfo
      : req.pincode
        ? await lookupPincodeInfo(db, req.pincode)
        : null;

  let appliedCoupon: AppliedCoupon | null = null;
  let coupon: QuoteCoupon | null = null;
  const code = req.couponCode?.trim();
  if (code) {
    const check = await validateCoupon(db, code, req.lines, req.email, {
      now,
      lock: req.lockCoupon,
    });
    if (check.ok) {
      appliedCoupon = check.applied;
      coupon = { code: check.applied.code, applied: true, message: null, rejectCode: null };
    } else {
      coupon = { code: code.toUpperCase(), applied: false, message: check.message, rejectCode: check.code };
    }
  }

  const price = priceCart({
    lines: req.lines,
    coupon: appliedCoupon,
    shipping: {
      flatFeePaise: settings.shipping.flatFeePaise,
      freeThresholdPaise: settings.shipping.freeThresholdPaise,
      zoneFeeOverridesPaise: settings.shipping.zoneFeeOverridesPaise,
    },
    zone: pincode?.zone ?? null,
    paymentMethod: req.paymentMethod,
    cod: { feePaise: settings.cod.feePaise },
    shippingTaxRule: settings.tax.shippingTaxRule,
    sellerStateCode: settings.tax.sellerStateCode,
    buyerStateCode: pincode?.stateCode ?? null,
  });
  return { price, coupon, appliedCoupon, pincode, settings };
}
