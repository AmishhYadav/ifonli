"use server";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import { adjustVariantStock, type AdjustResult } from "@/server/services/admin/inventory";

export async function adjustStockAction(input: unknown): Promise<ActionResult<AdjustResult>> {
  return runAdminAction("inventory:adjust", async ({ actor }) => {
    const res = await adjustVariantStock(getDb(), input, actor);
    revalidateStock({ productIds: [res.productId] });
    return res;
  });
}
