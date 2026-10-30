import { and, asc, eq, inArray } from "drizzle-orm";

import { stockReservations, variants } from "@/server/db/schema";
import { availableQty, type ReservationLike } from "@/server/domain";

import type { DbClient } from "./shared";

export interface VariantStock {
  variantId: string;
  productId: string;
  active: boolean;
  onHand: number;
  /** `variants.low_stock_threshold` (NULL = use the default setting). */
  lowStockThreshold: number | null;
  /** onHand minus active, unexpired reservations, never below zero (domain `availableQty`). */
  available: number;
}

/**
 * Loads variants plus their `active` reservations and computes availability with the domain
 * helper. Expiry is evaluated here at read time (`availableQty`), so correctness never depends on
 * the release cron. `lock` takes `SELECT ... FOR UPDATE` row locks (ordered by id) and only makes
 * sense inside a transaction (checkout).
 */
export async function loadVariantStock(
  db: DbClient,
  variantIds: readonly string[],
  now: Date,
  opts: { lock?: boolean } = {},
): Promise<VariantStock[]> {
  if (variantIds.length === 0) return [];
  const ids = [...variantIds];
  const base = db
    .select({
      id: variants.id,
      productId: variants.productId,
      active: variants.active,
      stockOnHand: variants.stockOnHand,
      lowStockThreshold: variants.lowStockThreshold,
    })
    .from(variants)
    .where(inArray(variants.id, ids))
    .orderBy(asc(variants.id));
  const rows = opts.lock ? await base.for("update") : await base;
  if (rows.length === 0) return [];

  const reservations = await db
    .select({
      variantId: stockReservations.variantId,
      qty: stockReservations.qty,
      status: stockReservations.status,
      expiresAt: stockReservations.expiresAt,
    })
    .from(stockReservations)
    .where(
      and(
        inArray(
          stockReservations.variantId,
          rows.map((r) => r.id),
        ),
        eq(stockReservations.status, "active"),
      ),
    );
  const byVariant = new Map<string, ReservationLike[]>();
  for (const r of reservations) {
    const list = byVariant.get(r.variantId) ?? [];
    list.push({ qty: r.qty, status: r.status, expiresAt: r.expiresAt });
    byVariant.set(r.variantId, list);
  }
  return rows.map((r) => ({
    variantId: r.id,
    productId: r.productId,
    active: r.active,
    onHand: r.stockOnHand,
    lowStockThreshold: r.lowStockThreshold,
    available: availableQty(r.stockOnHand, byVariant.get(r.id) ?? [], now),
  }));
}
