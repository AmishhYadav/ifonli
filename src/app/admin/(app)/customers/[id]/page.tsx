import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  AddressesCard,
  OrdersCard,
  ProfileCard,
  StatsCard,
  SupportCard,
} from "@/components/admin/customers/CustomerDetailCards";
import { CustomerDpdpPanel } from "@/components/admin/customers/CustomerDpdpPanel";
import { CustomerKindBadge } from "@/components/admin/customers/CustomerKindBadge";
import { PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getCustomerDetail } from "@/server/services/admin/customers";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin("customer:view");
  const { id } = await params;
  const detail = await getCustomerDetail(getDb(), id);
  if (!detail) notFound();
  // A guest link whose e-mail has since become an account lands on the account.
  if (detail.ref !== id) redirect(`/admin/customers/${detail.ref}`);

  const role = session.user.role;
  return (
    <>
      <PageHeader
        back={{ href: "/admin/customers", label: "Customers" }}
        title={detail.name || detail.email}
        description={detail.name ? detail.email : undefined}
        badges={<CustomerKindBadge kind={detail.kind} />}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-5">
          <OrdersCard detail={detail} canViewOrders={can(role, "order:view")} />
          <SupportCard detail={detail} canViewSupport={can(role, "support:view")} />
          <AddressesCard detail={detail} />
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <ProfileCard detail={detail} />
          <StatsCard detail={detail} />
          <CustomerDpdpPanel
            customerRef={detail.ref}
            kind={detail.kind}
            email={detail.email}
            allow={{ export: can(role, "customer:export"), delete: can(role, "customer:delete") }}
          />
        </div>
      </div>
    </>
  );
}
