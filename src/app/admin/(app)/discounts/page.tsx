import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { CouponsTable } from "@/components/admin/discounts/CouponsTable";
import { Button, PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listCoupons } from "@/server/services/admin/discounts";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Discounts" };

export default async function DiscountsPage() {
  const session = await requireAdmin("coupon:view");
  const rows = await listCoupons(getDb(), { role: session.user.role });
  const canManage = can(session.user.role, "coupon:manage");
  return (
    <>
      <PageHeader
        title="Discounts"
        description="Coupon codes. One code per order; codes are not case-sensitive."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/admin/discounts/new">
                <Plus aria-hidden /> New coupon
              </Link>
            </Button>
          ) : undefined
        }
      />
      <CouponsTable
        canManage={canManage}
        rows={rows.map((c) => ({
          id: c.id,
          code: c.code,
          kind: c.kind,
          value: c.value,
          minSubtotalPaise: c.minSubtotalPaise,
          maxDiscountPaise: c.maxDiscountPaise,
          startsAt: c.startsAt?.toISOString() ?? null,
          endsAt: c.endsAt?.toISOString() ?? null,
          usageLimit: c.usageLimit,
          active: c.active,
          state: c.state,
          stats: c.stats,
          scoped: Object.values(c.scope).some((l) => l.length > 0),
        }))}
      />
    </>
  );
}
