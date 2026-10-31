import type { Metadata } from "next";

import { CouponForm } from "@/components/admin/discounts/CouponForm";
import { EMPTY_COUPON_FORM } from "@/components/admin/discounts/form-values";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getCouponFormOptions } from "@/server/services/admin/discounts";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "New coupon" };

export default async function NewCouponPage() {
  await requireAdmin("coupon:manage");
  const options = await getCouponFormOptions(getDb());
  return (
    <>
      <PageHeader back={{ href: "/admin/discounts", label: "Discounts" }} title="New coupon" />
      <CouponForm couponId={null} defaultValues={EMPTY_COUPON_FORM} options={options} locked={false} />
    </>
  );
}
