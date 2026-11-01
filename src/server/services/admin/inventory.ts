import "server-only";

import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { csvCell } from "@/lib/csv";
import { assertCan } from "@/server/auth/permissions";
import { products, variants } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { adjustStock } from "@/server/services/inventory";
import { readSettings, type DbClient } from "@/server/services/queries/shared";
import { loadVariantStock } from "@/server/services/queries/stock";

import type { AdminActor } from "./products";

export type InventoryFilter = "all" | "low" | "out";

export interface InventoryRow {
  variantId: string;
  sku: string;
  variantTitle: string;
  productId: string;
  productName: string;
  productSlug: string;
  productStatus: "draft" | "active" | "archived";
  active: boolean;
  onHand: number;
  /** Held by active, unexpired checkout reservations. */
  reserved: number;
  available: number;
  threshold: number;
  state: "in" | "low" | "out";
}

/** One row per variant of non-archived products, with live reservations subtracted. */
export async function listInventory(
  db: DbClient,
  opts: { filter?: InventoryFilter; q?: string } = {},
  now: Date = new Date(),
): Promise<InventoryRow[]> {
  const q = opts.q?.trim();
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db
    .select({
      variantId: variants.id,
      sku: variants.sku,
      variantTitle: variants.title,
      active: variants.active,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
      productStatus: products.status,
    })
    .from(variants)
    .innerJoin(products, eq(variants.productId, products.id))
    .where(
      and(
        sql`${products.status} <> 'archived'`,
        like
          ? or(ilike(products.name, like), ilike(variants.sku, like), ilike(variants.title, like))
          : undefined,
      ),
    )
    .orderBy(asc(products.name), asc(variants.position), asc(variants.sku));
  if (rows.length === 0) return [];

  const [stock, settings] = await Promise.all([
    loadVariantStock(
      db,
      rows.map((r) => r.variantId),
      now,
    ),
    readSettings(db, ["default_low_stock_threshold"]),
  ]);
  const byId = new Map(stock.map((s) => [s.variantId, s]));
  const fallback = settings.default_low_stock_threshold.value;

  const out: InventoryRow[] = [];
  for (const r of rows) {
    const s = byId.get(r.variantId);
    if (!s) continue;
    const threshold = s.lowStockThreshold ?? fallback;
    const state = s.available <= 0 ? "out" : s.available <= threshold ? "low" : "in";
    if (opts.filter === "low" && state !== "low") continue;
    if (opts.filter === "out" && state !== "out") continue;
    out.push({
      ...r,
      onHand: s.onHand,
      reserved: Math.max(0, s.onHand - s.available),
      available: s.available,
      threshold,
      state,
    });
  }
  return out;
}

export function inventoryCsv(rows: readonly InventoryRow[]): string {
  const header = [
    "Product",
    "Variant",
    "SKU",
    "Status",
    "On hand",
    "Reserved",
    "Available",
    "Low-stock threshold",
    "State",
  ];
  const lines = rows.map((r) =>
    [
      r.productName,
      r.variantTitle,
      r.sku,
      r.active ? r.productStatus : "inactive",
      r.onHand,
      r.reserved,
      r.available,
      r.threshold,
      r.state,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

export const ADJUST_REASONS = ["restock", "adjust", "correction", "return_restock"] as const;

export const adjustInputSchema = z.object({
  variantId: z.uuid(),
  /** Signed whole number of units; never zero. */
  delta: z
    .number()
    .int("Whole units only")
    .refine((n) => n !== 0, "Enter a quantity other than 0")
    .refine((n) => Math.abs(n) <= 1_000_000, "Quantity is too large"),
  reason: z.enum(ADJUST_REASONS),
  note: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
});

export interface AdjustResult {
  productId: string;
  previousQty: number;
  newQty: number;
}

/** Manual stock change from the admin: ledger row + new on-hand + audit row in one transaction. */
export async function adjustVariantStock(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<AdjustResult> {
  assertCan(actor.role, "inventory:adjust");
  const input = adjustInputSchema.parse(raw);
  if ((input.reason === "adjust" || input.reason === "correction") && !input.note) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["note"],
        message: "A note is required for adjustments and corrections",
        input: input.note,
      },
    ]);
  }
  return db.transaction(async (tx) => {
    const [v] = await tx
      .select({ productId: variants.productId, sku: variants.sku })
      .from(variants)
      .where(inArray(variants.id, [input.variantId]));
    const res = await adjustStock(
      {
        variantId: input.variantId,
        delta: input.delta,
        reason: input.reason,
        actorId: actor.id,
        note: input.note,
      },
      tx,
    );
    await writeAudit(tx, {
      actorId: actor.id,
      action: "stock.adjust",
      entity: "variant",
      entityId: input.variantId,
      diff: {
        sku: v?.sku,
        from: res.previousQty,
        to: res.newQty,
        delta: input.delta,
        reason: input.reason,
        note: input.note,
      },
      ip: actor.ip,
    });
    return { productId: v!.productId, previousQty: res.previousQty, newQty: res.newQty };
  });
}
