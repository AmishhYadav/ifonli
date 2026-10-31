import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { OrderActionsPanel } from "@/components/admin/orders/OrderActionsPanel";
import {
  CustomerCard,
  DocumentsCard,
  ItemsCard,
  PaymentsCard,
  ReplacementLinks,
  ShipmentsCard,
  SupportLinksCard,
  TimelineCard,
} from "@/components/admin/orders/OrderDetailCards";
import { OrderNoteForm } from "@/components/admin/orders/OrderNoteForm";
import { FulfilmentBadge, MethodBadge, OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/orders/status";
import { PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getAdminOrderDetail } from "@/server/services/admin/orders";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Order" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin("order:view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await getAdminOrderDetail(getDb(), id);
  if (!detail) notFound();

  const role = session.user.role;
  const { order, actions } = detail;
  const allow = {
    fulfil: can(role, "order:update_fulfilment"),
    ship: can(role, "order:add_shipment"),
    cod: can(role, "order:mark_cod_collected"),
    cancel: can(role, "order:cancel"),
    refund: can(role, "order:refund"),
    resend: can(role, "order:resend_notification"),
  };
  const RESEND_LABEL = {
    order_confirmed: "Order confirmation",
    order_shipped: "Shipped",
    order_delivered: "Delivered",
    order_cancelled: "Cancelled",
  } as const;

  return (
    <>
      <PageHeader
        back={{ href: "/admin/orders", label: "Orders" }}
        title={<span className="font-mono">{order.ref}</span>}
        description={`${detail.customerName || "Guest"} · ${order.email}`}
        badges={
          <span className="flex flex-wrap items-center gap-1">
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
            <FulfilmentBadge status={order.fulfillmentStatus} />
            <MethodBadge method={order.paymentMethod} />
            <ReplacementLinks detail={detail} />
          </span>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-5">
          <ItemsCard detail={detail} />
          <PaymentsCard detail={detail} />
          <TimelineCard detail={detail}>
            {can(role, "order:note") ? <OrderNoteForm orderId={order.id} /> : null}
          </TimelineCard>
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <OrderActionsPanel
            orderId={order.id}
            orderRef={order.ref}
            paymentMethod={order.paymentMethod}
            status={order.status}
            fulfilment={actions.fulfilment}
            canAddShipment={actions.canAddShipment}
            canMarkCodCollected={actions.canMarkCodCollected}
            canCancel={actions.canCancel}
            canRefund={actions.canRefund}
            resend={actions.resend.map((value) => ({ value, label: RESEND_LABEL[value] }))}
            allow={allow}
            totalPaise={order.totalPaise}
            refundablePaise={detail.money.refundablePaise}
            hasShipment={detail.shipments.length > 0}
            items={detail.items.map((i) => ({
              variantId: i.variantId,
              name: i.variantTitle !== "Default" ? `${i.productName} (${i.variantTitle})` : i.productName,
              sku: i.sku,
              qty: i.qty,
              restockable: i.restockable,
            }))}
          />
          <CustomerCard
            detail={detail}
            customerHref={
              can(role, "customer:view")
                ? `/admin/customers/${order.userId ?? `o-${order.id}`}`
                : undefined
            }
          />
          <SupportLinksCard detail={detail} canViewSupport={can(role, "support:view")} />
          <ShipmentsCard detail={detail} />
          <DocumentsCard
            detail={detail}
            canInvoice={can(role, "order:invoice")}
            canPackingSlip={can(role, "order:packing_slip")}
          />
        </div>
      </div>
    </>
  );
}
