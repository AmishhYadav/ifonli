import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/server/db";
import { inventoryMovements, products, variants } from "@/server/db/schema";

import { readSettings, type DbClient } from "./queries/shared";
import { loadVariantStock } from "./queries/stock";

/** A Drizzle client or an open transaction. Defaults to the app client. */
export type Tx = DbClient;

export type MovementReason = (typeof inventoryMovements.$inferInsert)["reason"];

export class VariantNotFoundError extends Error {
  constructor(readonly variantId: string) {
    super(`Variant ${variantId} not found`);
    this.name = "VariantNotFoundError";
  }
}

export class InsufficientStockError extends Error {
  constructor(
    readonly variantId: string,
    readonly delta: number,
    readonly onHand: number,
  ) {
    super(`Cannot adjust variant ${variantId} by ${delta}: only ${onHand} on hand`);
    this.name = "InsufficientStockError";
  }
}

export class InvalidStockAdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStockAdjustmentError";
  }
}

export interface VariantAvailability {
  variantId: string;
  onHand: number;
  /** onHand minus active, unexpired reservations (never below 0). */
  available: number;
}

/**
 * Availability for variants (domain `availableQty`: reservations that are `active` and not yet
 * expired are subtracted; expiry is evaluated at read time). `lock: true` row-locks the variants
 * (`FOR UPDATE`, ordered by id) so checkout can recompute and reserve safely inside its
 * transaction. Unknown ids are simply absent from the result.
 */
export async function getVariantAvailability(
  variantIds: readonly string[],
  tx?: Tx,
  opts: { now?: Date; lock?: boolean } = {},
): Promise<VariantAvailability[]> {
  const rows = await loadVariantStock(tx ?? getDb(), variantIds, opts.now ?? new Date(), {
    lock: opts.lock,
  });
  return rows.map((r) => ({ variantId: r.variantId, onHand: r.onHand, available: r.available }));
}

export interface AdjustStockInput {
  variantId: string;
  /** Non-zero integer: positive adds stock, negative removes it. */
  delta: number;
  reason: MovementReason;
  /** Better Auth user id, or null for system actions. */
  actorId: string | null;
  note?: string | null;
  orderId?: string | null;
}

export interface AdjustStockResult {
  movementId: string;
  variantId: string;
  delta: number;
  previousQty: number;
  newQty: number;
}

/**
 * Atomically changes `variants.stock_on_hand` and appends the ledger row. Runs in the supplied
 * transaction, or opens its own. The guarded `UPDATE ... WHERE stock_on_hand + delta >= 0` takes
 * the row lock, so two concurrent decrements of the last unit serialise and the second fails with
 * `InsufficientStockError` (the DB CHECK is the backstop). Note this guards on-hand stock, not
 * reservations: callers that must respect live reservations check `getVariantAvailability` first.
 */
export async function adjustStock(input: AdjustStockInput, tx?: Tx): Promise<AdjustStockResult> {
  if (!Number.isSafeInteger(input.delta) || input.delta === 0) {
    throw new InvalidStockAdjustmentError("delta must be a non-zero integer");
  }
  const run = async (db: Tx): Promise<AdjustStockResult> => {
    const [updated] = await db
      .update(variants)
      .set({ stockOnHand: sql`${variants.stockOnHand} + ${input.delta}` })
      .where(
        and(
          eq(variants.id, input.variantId),
          sql`${variants.stockOnHand} + ${input.delta} >= 0`,
        ),
      )
      .returning({ stockOnHand: variants.stockOnHand });
    if (!updated) {
      const [current] = await db
        .select({ stockOnHand: variants.stockOnHand })
        .from(variants)
        .where(eq(variants.id, input.variantId));
      if (!current) throw new VariantNotFoundError(input.variantId);
      throw new InsufficientStockError(input.variantId, input.delta, current.stockOnHand);
    }
    const [movement] = await db
      .insert(inventoryMovements)
      .values({
        variantId: input.variantId,
        delta: input.delta,
        reason: input.reason,
        orderId: input.orderId ?? null,
        actorId: input.actorId,
        note: input.note ?? null,
      })
      .returning({ id: inventoryMovements.id });
    return {
      movementId: movement!.id,
      variantId: input.variantId,
      delta: input.delta,
      previousQty: updated.stockOnHand - input.delta,
      newQty: updated.stockOnHand,
    };
  };
  if (tx) return run(tx);
  return getDb().transaction((t) => run(t));
}

export interface LowStockRow {
  variantId: string;
  sku: string;
  variantTitle: string;
  productId: string;
  productName: string;
  productSlug: string;
  onHand: number;
  available: number;
  threshold: number;
}

/**
 * Active variants of non-archived products whose available stock is at or below their threshold
 * (variant override, else `default_low_stock_threshold`), lowest first. Includes sold-out (0).
 */
export async function listLowStock(tx?: Tx, opts: { now?: Date } = {}): Promise<LowStockRow[]> {
  const db = tx ?? getDb();
  const rows = await db
    .select({
      variantId: variants.id,
      sku: variants.sku,
      variantTitle: variants.title,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
    })
    .from(variants)
    .innerJoin(products, eq(variants.productId, products.id))
    .where(and(eq(variants.active, true), sql`${products.status} <> 'archived'`));
  if (rows.length === 0) return [];
  const [stock, settingsRead] = await Promise.all([
    loadVariantStock(
      db,
      rows.map((r) => r.variantId),
      opts.now ?? new Date(),
    ),
    readSettings(db, ["default_low_stock_threshold"]),
  ]);
  const byId = new Map(stock.map((s) => [s.variantId, s]));
  const fallback = settingsRead.default_low_stock_threshold.value;
  const out: LowStockRow[] = [];
  for (const r of rows) {
    const s = byId.get(r.variantId);
    if (!s) continue;
    const threshold = s.lowStockThreshold ?? fallback;
    if (s.available <= threshold) {
      out.push({ ...r, onHand: s.onHand, available: s.available, threshold });
    }
  }
  return out.sort(
    (a, b) =>
      a.available - b.available ||
      a.productName.localeCompare(b.productName) ||
      a.sku.localeCompare(b.sku),
  );
}

export interface LedgerEntry {
  id: string;
  variantId: string;
  delta: number;
  reason: MovementReason;
  orderId: string | null;
  actorId: string | null;
  note: string | null;
  createdAt: Date;
}

/** Stock ledger for one variant, newest first. */
export async function ledgerFor(
  variantId: string,
  opts: { limit?: number; offset?: number } = {},
  tx?: Tx,
): Promise<LedgerEntry[]> {
  const db = tx ?? getDb();
  return db
    .select({
      id: inventoryMovements.id,
      variantId: inventoryMovements.variantId,
      delta: inventoryMovements.delta,
      reason: inventoryMovements.reason,
      orderId: inventoryMovements.orderId,
      actorId: inventoryMovements.actorId,
      note: inventoryMovements.note,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.variantId, variantId))
    .orderBy(desc(inventoryMovements.createdAt), asc(inventoryMovements.id))
    .limit(Math.min(Math.max(1, opts.limit ?? 100), 500))
    .offset(Math.max(0, opts.offset ?? 0));
}
