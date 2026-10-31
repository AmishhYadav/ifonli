import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { CouponForm } from "@/components/admin/discounts/CouponForm";
import { couponToFormValues } from "@/components/admin/discounts/form-values";
import { CouponStateBadge } from "@/components/admin/discounts/CouponsTable";
import { formatDateTime } from "@/components/admin/orders/status";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/ui";
import { formatINR } from "@/lib/money";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getCoupon, getCouponFormOptions } from "@/server/services/admin/discounts";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Coupon" };

export default async function CouponPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin("coupon:view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const [coupon, options] = await Promise.all([
    getCoupon(db, id, { role: session.user.role }),
    getCouponFormOptions(db),
  ]);
  if (!coupon) notFound();
  const s = coupon.stats;
  const stats = [
    { label: "Orders using it", value: String(s.confirmed) },
    { label: "In open checkouts", value: String(s.reserved) },
    { label: "Released", value: String(s.released) },
    { label: "Order value", value: formatINR(s.revenuePaise) },
    { label: "Discount given", value: formatINR(s.discountPaise) },
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/admin/discounts", label: "Discounts" }}
        title={<span className="font-mono">{coupon.code}</span>}
        badges={<CouponStateBadge state={coupon.state} />}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((x) => (
          <Card key={x.label} className="p-4">
            <p className="text-xs text-admin-ink-muted">{x.label}</p>
            <p className="tabular mt-1 text-xl font-semibold">{x.value}</p>
          </Card>
        ))}
      </div>
      <CouponForm
        couponId={coupon.id}
        defaultValues={couponToFormValues(coupon)}
        options={options}
        locked={coupon.stats.reserved + coupon.stats.confirmed + coupon.stats.released > 0}
        canManage={can(session.user.role, "coupon:manage")}
      />
      {coupon.recent.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Recent redemptions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Order total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coupon.recent.map((r) => (
                  <TableRow key={r.orderId}>
                    <TableCell>
                      <Link href={`/admin/orders/${r.orderId}`} className="font-mono text-[13px] text-admin-primary hover:underline">
                        {r.ref}
                      </Link>
                      <span className="block text-xs text-admin-ink-muted">{formatDateTime(r.createdAt)}</span>
                    </TableCell>
                    <TableCell>{r.email}</TableCell>
                    <TableCell>
                      <Badge tone={r.status === "confirmed" ? "success" : r.status === "reserved" ? "warning" : "neutral"}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="tabular text-right">{formatINR(r.discountPaise)}</TableCell>
                    <TableCell className="tabular text-right">{formatINR(r.totalPaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
