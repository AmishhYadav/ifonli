import { rupees, toCsv } from "@/lib/csv";

import type { FunnelStep } from "./funnel";
import type { CouponRow, OrdersByStatus, SalesReport, TopRow } from "./reports";

/** CSV exports of the admin reports (pure). Money is in rupees with two decimals so spreadsheets can sum it. */

export const REPORT_KINDS = ["sales", "status", "products", "vibes", "types", "coupons", "funnel"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export function isReportKind(v: unknown): v is ReportKind {
  return typeof v === "string" && (REPORT_KINDS as readonly string[]).includes(v);
}

const pct = (r: number | null) => (r === null ? "" : (r * 100).toFixed(2));

export function salesCsv(report: SalesReport): string {
  const label = report.bucket === "day" ? "Day" : "Week starting (Monday)";
  return toCsv(
    [label, "Orders", "Revenue (INR)", "Discounts (INR)", "Average order value (INR)"],
    report.points.map((p) => [
      p.bucket,
      p.orders,
      rupees(p.revenuePaise),
      rupees(p.discountPaise),
      p.aovPaise === null ? "" : rupees(p.aovPaise),
    ]),
  );
}

export function statusCsv(data: OrdersByStatus): string {
  const rows = [
    ...data.byStatus.map((r) => ["Order status", r.status, r.orders, rupees(r.valuePaise)] as const),
    ...data.byPayment.map((r) => ["Payment status", r.status, r.orders, rupees(r.valuePaise)] as const),
    ...data.byMethod.map((r) => ["Payment method", r.status, r.orders, rupees(r.valuePaise)] as const),
  ];
  return toCsv(["Group", "Value", "Orders", "Order value (INR)"], rows);
}

export function topCsv(label: string, rows: readonly TopRow[]): string {
  return toCsv(
    [label, "Orders", "Units", "Revenue (INR)"],
    rows.map((r) => [r.name, r.orders, r.units, rupees(r.revenuePaise)]),
  );
}

export function couponsCsv(rows: readonly CouponRow[]): string {
  return toCsv(
    ["Code", "Orders", "Discount given (INR)", "Items value (INR)", "Order totals (INR)", "Discount rate (%)"],
    rows.map((r) => [
      r.code,
      r.orders,
      rupees(r.discountPaise),
      rupees(r.subtotalPaise),
      rupees(r.revenuePaise),
      pct(r.discountRate),
    ]),
  );
}

export function funnelCsv(steps: readonly FunnelStep[]): string {
  return toCsv(
    ["Stage", "Sessions", "Of all sessions (%)", "Of previous stage (%)", "Dropped since previous"],
    steps.map((s) => [s.label, s.count, pct(s.ofStart), pct(s.ofPrevious), s.dropped]),
  );
}

export function reportFilename(kind: ReportKind, range: { from: string; to: string }): string {
  return `ifonli-${kind}-${range.from}_to_${range.to}.csv`;
}
