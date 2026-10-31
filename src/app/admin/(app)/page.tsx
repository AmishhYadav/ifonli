import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { StatCard } from "@/components/admin/dashboard/StatCard";
import { NAV_ITEMS, hrefFor } from "@/components/admin/nav";
import { FulfilmentBadge, OrderStatusBadge, PaymentStatusBadge, formatDateTime } from "@/components/admin/orders/status";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/admin/ui";
import { formatINR } from "@/lib/money";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getDashboardStats, type DashboardAnomaly } from "@/server/services/admin/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

const ANOMALY_LABEL: Record<DashboardAnomaly["kind"], string> = {
  duplicate_payment: "Duplicate payment awaiting refund",
  late_capture_refund: "Late payment awaiting refund",
  refund_pending: "Refund pending for over 30 minutes",
  refund_failed: "Refund failed at the provider",
};

export default async function DashboardPage() {
  const session = await requireAdmin();
  if (!can(session.user.role, "dashboard:view")) {
    // Fulfilment staff land on their first module instead of an empty dashboard.
    const first = NAV_ITEMS.find((i) => can(session.user.role, i.permission));
    redirect(first ? hrefFor(first) : "/admin/forbidden");
  }
  const stats = await getDashboardStats(getDb(), {
    withActivity: can(session.user.role, "audit:view"),
  });
  const a = stats.anomalies;
  const anomalyCount = a.duplicateOrLate + a.pendingRefunds + a.failedRefunds;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${session.user.name.split(" ")[0]}`}
        description="Sales are paid online orders plus cash-on-delivery orders placed, excluding cancelled and refunded ones. Days are India time."
      />

      <section aria-label="Sales" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Orders today" value={String(stats.sales.today.orders)} href="/admin/orders" />
        <StatCard label="Revenue today" value={formatINR(stats.sales.today.revenuePaise)} />
        <StatCard label="Orders, last 7 days" value={String(stats.sales.week.orders)} />
        <StatCard label="Revenue, last 7 days" value={formatINR(stats.sales.week.revenuePaise)} />
      </section>

      <section aria-label="Needs attention" className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Average order value"
          value={stats.sales.aovPaise === null ? "-" : formatINR(stats.sales.aovPaise)}
          hint="Last 7 days"
        />
        <StatCard
          label="Awaiting fulfilment"
          value={String(stats.awaitingFulfilment.total)}
          hint={`${stats.awaitingFulfilment.unfulfilled} to pack · ${stats.awaitingFulfilment.packed} packed`}
          href="/admin/orders?fulfilment=unfulfilled"
          tone={stats.awaitingFulfilment.total > 0 ? "warning" : undefined}
        />
        <StatCard
          label="Low / out of stock"
          value={`${stats.lowStock} / ${stats.outOfStock}`}
          hint="Variants"
          href="/admin/inventory?filter=low"
          tone={stats.outOfStock > 0 ? "danger" : stats.lowStock > 0 ? "warning" : undefined}
        />
        <StatCard label="Open support cases" value={String(stats.openSupportCases)} hint="Damaged, defective, missing" />
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent orders</CardTitle>
            <Link href="/admin/orders" className="text-[13px] text-admin-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {stats.recentOrders.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-admin-ink-muted">No orders yet.</p>
            ) : (
              <ul className="divide-y divide-admin-border">
                {stats.recentOrders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:bg-admin-surface-2/50">
                      <span className="min-w-0">
                        <span className="block font-mono text-[13px] font-medium text-admin-ink">{o.ref}</span>
                        <span className="block text-xs text-admin-ink-muted">
                          {o.customerName || "Guest"} · {formatDateTime(o.placedAt)}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <OrderStatusBadge status={o.status} />
                        <PaymentStatusBadge status={o.paymentStatus} />
                        <FulfilmentBadge status={o.fulfillmentStatus} />
                        <span className="tabular w-20 text-right text-[13px] font-medium">{formatINR(o.totalPaise)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Payment anomalies
                <Badge tone={anomalyCount > 0 ? "danger" : "success"}>{anomalyCount > 0 ? anomalyCount : "All clear"}</Badge>
              </CardTitle>
              <CardDescription>
                Refunds that did not complete, duplicate charges and late payments.
                {a.lateConfirmed7d > 0 ? ` ${a.lateConfirmed7d} late payment(s) were still confirmed this week.` : ""}
              </CardDescription>
            </CardHeader>
            {a.items.length > 0 ? (
              <CardContent>
                <ul className="divide-y divide-admin-border text-[13px]">
                  {a.items.map((i, idx) => (
                    <li key={`${i.orderId}-${idx}`}>
                      <Link href={`/admin/orders/${i.orderId}`} className="flex items-start justify-between gap-3 py-2 hover:bg-admin-surface-2/50">
                        <span>
                          <span className="block text-admin-ink">{ANOMALY_LABEL[i.kind]}</span>
                          <span className="block font-mono text-xs text-admin-ink-muted">{i.ref}</span>
                        </span>
                        <span className="tabular shrink-0">{formatINR(i.amountPaise)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Catalogue</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
              <Link href="/admin/products?status=active" className="hover:underline">
                <span className="tabular font-semibold">{stats.products.active}</span> active
              </Link>
              <Link href="/admin/products?status=draft" className="hover:underline">
                <span className="tabular font-semibold">{stats.products.draft}</span> drafts
              </Link>
              <span>
                <span className="tabular font-semibold">{stats.products.archived}</span> archived
              </span>
            </CardContent>
          </Card>
        </div>
      </div>

      {stats.recentActivity.length > 0 ? (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-admin-border text-[13px]">
              {stats.recentActivity.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">{x.actorName ?? "System"}</span>{" "}
                    <span className="text-admin-ink-muted">{x.action}</span>
                  </span>
                  <time className="shrink-0 text-xs text-admin-ink-faint" dateTime={x.createdAt.toISOString()}>
                    {formatDateTime(x.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
