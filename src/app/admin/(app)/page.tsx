import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { NAV_ITEMS, hrefFor } from "@/components/admin/nav";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getDashboardStats } from "@/server/services/admin/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

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

  const cards = [
    {
      label: "Active products",
      value: stats.products.active,
      href: "/admin/products?status=active",
      tone: "success" as const,
    },
    {
      label: "Drafts",
      value: stats.products.draft,
      href: "/admin/products?status=draft",
      tone: "neutral" as const,
    },
    {
      label: "Low stock variants",
      value: stats.lowStock,
      href: "/admin/products?stock=low",
      tone: "warning" as const,
    },
    {
      label: "Out of stock variants",
      value: stats.outOfStock,
      href: "/admin/products?stock=out",
      tone: "danger" as const,
    },
  ];

  return (
    <>
      <PageHeader
        title={`Welcome back, ${session.user.name.split(" ")[0]}`}
        description="A quick look at the catalogue."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="group">
            <Card className="p-4 transition-colors group-hover:border-admin-border-strong">
              <p className="text-xs text-admin-ink-muted">{c.label}</p>
              <p className="tabular mt-1 text-2xl font-semibold">{c.value}</p>
              <Badge tone={c.tone} className="mt-2">
                View
              </Badge>
            </Card>
          </Link>
        ))}
      </div>

      {stats.recentActivity.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-admin-border text-[13px]">
              {stats.recentActivity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">{a.actorName ?? "System"}</span>{" "}
                    <span className="text-admin-ink-muted">{a.action}</span>
                  </span>
                  <time
                    className="shrink-0 text-xs text-admin-ink-faint"
                    dateTime={a.createdAt.toISOString()}
                  >
                    {a.createdAt.toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Kolkata",
                    })}
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
