import { ForbiddenError, requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { parseDateRange } from "@/server/services/analytics/dates";
import {
  couponsCsv,
  funnelCsv,
  isReportKind,
  reportFilename,
  salesCsv,
  statusCsv,
  topCsv,
  type ReportKind,
} from "@/server/services/analytics/report-csv";
import {
  getCouponPerformance,
  getFunnel,
  getOrdersByStatus,
  getSalesReport,
  getTopProducts,
  getTopTypes,
  getTopVibes,
} from "@/server/services/analytics/reports";
import type { DbClient } from "@/server/services/queries/shared";
import type { DateRange } from "@/server/services/analytics/dates";

async function build(kind: ReportKind, db: DbClient, range: DateRange, bucket: "day" | "week"): Promise<string> {
  switch (kind) {
    case "sales":
      return salesCsv(await getSalesReport(db, range, bucket));
    case "status":
      return statusCsv(await getOrdersByStatus(db, range));
    case "products":
      return topCsv("Product", await getTopProducts(db, range, 500));
    case "vibes":
      return topCsv("Vibe", await getTopVibes(db, range));
    case "types":
      return topCsv("Type", await getTopTypes(db, range));
    case "coupons":
      return couponsCsv(await getCouponPerformance(db, range));
    case "funnel":
      return funnelCsv(await getFunnel(db, range));
  }
}

/** CSV of one report for the chosen date range (`?report=sales&from=&to=&bucket=day|week`). Needs report:view. */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireAdmin("report:view", { denied: "throw" });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw error;
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get("report");
  if (!isReportKind(kind)) return new Response("Unknown report", { status: 400 });
  const range = parseDateRange(Object.fromEntries(url.searchParams), new Date());
  const bucket = url.searchParams.get("bucket") === "week" ? "week" : "day";

  const csv = await build(kind, getDb(), range, bucket);
  console.info(`[admin] report export ${kind} ${range.from}..${range.to} by ${session.user.id}`);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportFilename(kind, range)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
