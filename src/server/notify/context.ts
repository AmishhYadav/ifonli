import "server-only";

import { asc, eq } from "drizzle-orm";

import { isVibe } from "@/features/vibe/config";
import { orderItems, orders } from "@/server/db/schema";
import { readSettings, type DbClient } from "@/server/services/queries/shared";
import { siteUrl } from "@/lib/seo";

import type { EmailContext, OrderView, StoreInfo } from "../../../emails/types";

export async function loadStoreInfo(db: DbClient): Promise<StoreInfo> {
  const s = await readSettings(db, [
    "brand_name",
    "legal_name",
    "registered_address",
    "support_email",
    "support_phone",
    "support_hours",
    "grievance_officer",
  ]);
  return {
    brandName: s.brand_name.value,
    legalName: s.legal_name.value,
    address: s.registered_address.value,
    supportEmail: s.support_email.value,
    supportPhone: s.support_phone.value,
    supportHours: s.support_hours.value,
    grievance: s.grievance_officer.value,
  };
}

type Address = { name?: string; line1?: string; line2?: string | null; landmark?: string | null; city?: string; state?: string; pincode?: string };

export async function loadOrderView(db: DbClient, orderId: string): Promise<{ view: OrderView; vibe: string | null } | null> {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.createdAt), asc(orderItems.id));
  const a = (o.shippingAddress ?? {}) as Address;
  const cityLine = [a.city, [a.state, a.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    vibe: o.vibeAtOrder,
    view: {
      ref: o.ref,
      paymentMethod: o.paymentMethod,
      placedAt: o.placedAt.toISOString(),
      items: items.map((i) => ({
        name: i.productName,
        variant: i.variantTitle && i.variantTitle !== "Default" ? i.variantTitle : "",
        qty: i.qty,
        unitPaise: i.unitPricePaise,
        grossPaise: i.unitPricePaise * i.qty,
      })),
      subtotalPaise: o.subtotalPaise,
      discountPaise: o.discountPaise,
      shippingPaise: o.shippingPaise,
      codFeePaise: o.codFeePaise,
      totalPaise: o.totalPaise,
      taxIncludedPaise: o.taxIncludedPaise,
      couponCode: o.couponCode,
      shipTo: { name: a.name ?? "", lines: [a.line1, a.line2, a.landmark, cityLine].filter((l): l is string => Boolean(l)) },
    },
  };
}

/**
 * Everything a template needs beyond its payload: store details from settings and, for order e-mails,
 * the order read at send time (so a resend always shows current data and the outbox keeps no PII copy).
 * The palette follows `vibe_at_order`; without an order it is the neutral base.
 */
export async function loadEmailContext(db: DbClient, opts: { orderId?: string | null; audience: "customer" | "admin" }): Promise<EmailContext> {
  const store = await loadStoreInfo(db);
  const loaded = opts.audience === "customer" && opts.orderId ? await loadOrderView(db, opts.orderId) : null;
  return {
    store,
    siteUrl: siteUrl(),
    vibe: loaded && isVibe(loaded.vibe) ? loaded.vibe : null,
    order: loaded?.view,
  };
}
