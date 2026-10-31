import type { Metadata } from "next";
import Link from "next/link";

import { BarChart } from "@/components/admin/analytics/BarChart";
import { DateRangeForm } from "@/components/admin/analytics/DateRangeForm";
import { ReportCard, SimpleTable } from "@/components/admin/analytics/ReportParts";
import { StatCard } from "@/components/admin/dashboard/StatCard";
import { statusWords } from "@/components/admin/orders/status";
import { PageHeader, cn } from "@/components/admin/ui";
import { formatINR } from "@/lib/money";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { istDateString } from "@/server/domain/ist";
import { parseDateRange, type Bucket } from "@/server/services/analytics/dates";
import { formatPercent } from "@/server/services/analytics/funnel";
import {
  getCouponPerformance,
  getFunnel,
  getOrdersByStatus,
  getSalesReport,
  getTopProducts,
  getTopTypes,
  getTopVibes,
  type StatusRow,
  type TopRow,
} from "@/server/services/analytics/reports";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Reports" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const topColumns = (label: string) =>
  [
    { header: label, cell: (r: TopRow) => r.name },
    { header: "Orders", numeric: true, cell: (r: TopRow) => r.orders },
    { header: "Units", numeric: true, cell: (r: TopRow) => r.units },
    { header: "Revenue", numeric: true, cell: (r: TopRow) => formatINR(r.revenuePaise) },
  ] as const;

const statusColumns = (label: string) =>
  [
    { header: label, cell: (r: StatusRow) => statusWords(r.status) },
    { header: "Orders", numeric: true, cell: (r: StatusRow) => r.orders },
    { header: "Order value", numeric: true, cell: (r: StatusRow) => formatINR(r.valuePaise) },
  ] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("report:view");
  const sp = await searchParams;
  const now = new Date();
  const today = istDateString(now);
  const range = parseDateRange(sp, now);
  const bucket: Bucket = one(sp.bucket) === "week" ? "week" : "day";
  const db = getDb();

  const [sales, byStatus, products, vibes, types, coupons, funnel] = await Promise.all([
    getSalesReport(db, range, bucket),
    getOrdersByStatus(db, range),
    getTopProducts(db, range),
    getTopVibes(db, range),
    getTopTypes(db, range),
    getCouponPerformance(db, range),
    getFunnel(db, range),
  ]);

  const q = (extra: Record<string, string>) => new URLSearchParams({ from: range.from, to: range.to, ...extra });
  const exportHref = (report: string, extra: Record<string, string> = {}) =>
    `/admin/reports/export?${q({ report, ...extra })}`;
  const maxFunnel = Math.max(1, ...funnel.map((s) => s.count));

  return (
    <>
      <PageHeader
        title="Reports"
        description="Sales are paid online orders plus cash-on-delivery orders placed, excluding cancelled and refunded ones. Every day is an India (IST) day."
      />
      <DateRangeForm action="/admin/reports" range={range} today={today} keep={{ bucket }} />

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Orders" value={String(sales.totals.orders)} />
        <StatCard label="Revenue" value={formatINR(sales.totals.revenuePaise)} />
        <StatCard
          label="Average order value"
          value={sales.totals.aovPaise === null ? "-" : formatINR(sales.totals.aovPaise)}
        />
        <StatCard label="Discounts given" value={formatINR(sales.totals.discountPaise)} />
      </section>

      <div className="mt-5 grid gap-5">
        <ReportCard
          title="Sales"
          description={
            <>
              Revenue per {bucket === "day" ? "day" : "week (starting Monday)"}.{" "}
              <span className="inline-flex gap-2">
                {(["day", "week"] as const).map((b) => (
                  <Link
                    key={b}
                    href={`/admin/reports?${q({ bucket: b })}`}
                    aria-current={bucket === b ? "true" : undefined}
                    className={cn("hover:underline", bucket === b ? "font-semibold text-admin-ink" : "text-admin-primary")}
                  >
                    By {b}
                  </Link>
                ))}
              </span>
            </>
          }
          exportHref={exportHref("sales", { bucket })}
        >
          <BarChart
            ariaLabel={`Revenue by ${bucket}, ${range.from} to ${range.to}`}
            data={sales.points.map((p) => ({ label: p.bucket, value: p.revenuePaise, display: formatINR(p.revenuePaise) }))}
          />
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] text-admin-primary">Show as a table</summary>
            <SimpleTable
              caption={`Sales by ${bucket}`}
              rows={sales.points}
              rowKey={(p) => p.bucket}
              columns={[
                { header: bucket === "day" ? "Day" : "Week starting", cell: (p) => p.bucket },
                { header: "Orders", numeric: true, cell: (p) => p.orders },
                { header: "Revenue", numeric: true, cell: (p) => formatINR(p.revenuePaise) },
                { header: "Discounts", numeric: true, cell: (p) => formatINR(p.discountPaise) },
                { header: "AOV", numeric: true, cell: (p) => (p.aovPaise === null ? "-" : formatINR(p.aovPaise)) },
              ]}
            />
          </details>
        </ReportCard>

        <ReportCard
          title="Shopping funnel"
          description="Visits that reached each step, counted once per visit. Orders we could not tie to a visit (for example with analytics blocked) are real sales but are not in the funnel."
          exportHref={exportHref("funnel")}
        >
          <ol className="grid gap-3" aria-label="Funnel steps">
            {funnel.map((s) => (
              <li key={s.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                  <span className="font-medium text-admin-ink">{s.label}</span>
                  <span className="tabular text-admin-ink-muted">
                    <span className="font-semibold text-admin-ink">{s.count}</span>
                    {s.ofPrevious !== null ? ` · ${formatPercent(s.ofPrevious)} of previous step` : ""}
                    {s.ofStart !== null && s.key !== "sessions" ? ` · ${formatPercent(s.ofStart)} of all` : ""}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-admin-surface-2" aria-hidden>
                  <div className="h-full rounded-full bg-admin-primary" style={{ width: `${(s.count / maxFunnel) * 100}%` }} />
                </div>
              </li>
            ))}
          </ol>
        </ReportCard>

        <div className="grid gap-5 lg:grid-cols-2">
          <ReportCard title="Orders by status" description="All orders placed in the range, including cancelled ones." exportHref={exportHref("status")}>
            <SimpleTable caption="Orders by status" rows={byStatus.byStatus} rowKey={(r) => r.status} columns={statusColumns("Order status")} />
            <div className="mt-4">
              <SimpleTable caption="Orders by payment status" rows={byStatus.byPayment} rowKey={(r) => r.status} columns={statusColumns("Payment status")} />
            </div>
            <div className="mt-4">
              <SimpleTable caption="Orders by payment method" rows={byStatus.byMethod} rowKey={(r) => r.status} columns={statusColumns("Payment method")} />
            </div>
          </ReportCard>

          <ReportCard
            title="Coupon performance"
            description="Sales that used a code."
            exportHref={exportHref("coupons")}
          >
            <SimpleTable
              caption="Coupon performance"
              rows={coupons}
              rowKey={(r) => r.code}
              empty="No coupon was used in this range."
              columns={[
                { header: "Code", cell: (r) => <span className="font-mono text-[13px]">{r.code}</span> },
                { header: "Orders", numeric: true, cell: (r) => r.orders },
                { header: "Discount", numeric: true, cell: (r) => formatINR(r.discountPaise) },
                { header: "Rate", numeric: true, cell: (r) => formatPercent(r.discountRate) },
                { header: "Order totals", numeric: true, cell: (r) => formatINR(r.revenuePaise) },
              ]}
            />
          </ReportCard>
        </div>

        <ReportCard title="Top products" description="By revenue (line totals after discounts)." exportHref={exportHref("products")}>
          <SimpleTable caption="Top products" rows={products} rowKey={(r) => r.key} columns={topColumns("Product")} empty="No sales in this range." />
        </ReportCard>

        <div className="grid gap-5 lg:grid-cols-2">
          <ReportCard
            title="Top vibes"
            description="A product filed under several vibes counts towards each, so these can add up to more than total sales."
            exportHref={exportHref("vibes")}
          >
            <SimpleTable caption="Top vibes" rows={vibes} rowKey={(r) => r.key} columns={topColumns("Vibe")} empty="No sales in this range." />
          </ReportCard>
          <ReportCard title="Top product types" exportHref={exportHref("types")}>
            <SimpleTable caption="Top product types" rows={types} rowKey={(r) => r.key} columns={topColumns("Type")} empty="No sales in this range." />
          </ReportCard>
        </div>
      </div>
    </>
  );
}
