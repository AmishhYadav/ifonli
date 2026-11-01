"use server";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import { adjustVariantStock, type AdjustResult } from "@/server/services/admin/inventory";
import {
  applyInventoryImport,
  previewInventoryImport,
  type InventoryImportPreview,
} from "@/server/services/admin/inventory-import";

export async function adjustStockAction(input: unknown): Promise<ActionResult<AdjustResult>> {
  return runAdminAction("inventory:adjust", async ({ actor }) => {
    const res = await adjustVariantStock(getDb(), input, actor);
    revalidateStock({ productIds: [res.productId] });
    return res;
  });
}

/** Dry run of a stock CSV (text read in the browser). Writes nothing. */
export async function previewInventoryImportAction(
  input: unknown,
): Promise<ActionResult<InventoryImportPreview>> {
  return runAdminAction("inventory:import", ({ actor }) => previewInventoryImport(getDb(), input, actor));
}

/** Applies a previewed stock CSV in one transaction, then expires the stock caches like a manual adjustment. */
export async function applyInventoryImportAction(
  input: unknown,
): Promise<ActionResult<{ changed: number; unchanged: number }>> {
  return runAdminAction("inventory:import", async ({ actor }) => {
    const res = await applyInventoryImport(getDb(), input, actor);
    if (res.productIds.length > 0) revalidateStock({ productIds: res.productIds });
    return { changed: res.changed, unchanged: res.unchanged };
  });
}
