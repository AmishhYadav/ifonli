import { ForbiddenError, requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import {
  inventoryCsv,
  listInventory,
  type InventoryFilter,
} from "@/server/services/admin/inventory";

/** CSV of the current inventory view (same filter as the page). Needs inventory:view. */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireAdmin("inventory:view", { denied: "throw" });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw error;
  }
  const url = new URL(request.url);
  const f = url.searchParams.get("filter");
  const filter: InventoryFilter = f === "low" || f === "out" ? f : "all";
  const rows = await listInventory(getDb(), { filter });
  const stamp = new Date().toISOString().slice(0, 10);
  console.info(`[admin] inventory export by ${session.user.id}: ${rows.length} rows`);
  return new Response(inventoryCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventory-${filter}-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
