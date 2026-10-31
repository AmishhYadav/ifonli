import { ForbiddenError, requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { auditCsv, exportAuditLog } from "@/server/services/admin/audit";

import { auditFiltersFromParams } from "../filters";

/** CSV of the audit log under the same filters as the page (newest first, capped). Needs audit:view. */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireAdmin("audit:view", { denied: "throw" });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw error;
  }
  const url = new URL(request.url);
  const { page, ...filters } = auditFiltersFromParams(Object.fromEntries(url.searchParams));
  void page;
  const { rows, truncated } = await exportAuditLog(getDb(), { role: session.user.role }, filters);
  const stamp = new Date().toISOString().slice(0, 10);
  console.info(`[admin] audit export by ${session.user.id}: ${rows.length} rows${truncated ? " (truncated)" : ""}`);
  return new Response(auditCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
      ...(truncated ? { "X-Export-Truncated": "true" } : {}),
    },
  });
}
