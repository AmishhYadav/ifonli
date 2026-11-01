import { ForbiddenError, requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { exportPincodes, pincodesCsv } from "@/server/services/admin/pincodes";

import { pincodeFiltersFromParams } from "../filters";

/**
 * CSV of the pincodes under the current filter. The first three columns are exactly what the upload
 * reads, so the file can be edited and uploaded back. Needs setting:view.
 */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireAdmin("setting:view", { denied: "throw" });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw error;
  }
  const { page, ...filters } = pincodeFiltersFromParams(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  void page;
  const { rows, truncated } = await exportPincodes(getDb(), filters);
  const stamp = new Date().toISOString().slice(0, 10);
  console.info(`[admin] pincode export by ${session.user.id}: ${rows.length} rows${truncated ? " (truncated)" : ""}`);
  return new Response(pincodesCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pincodes-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
      ...(truncated ? { "X-Export-Truncated": "true" } : {}),
    },
  });
}
