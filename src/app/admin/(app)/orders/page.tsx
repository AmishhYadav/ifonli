import type { Metadata } from "next";

import { OrdersTable } from "@/components/admin/orders/OrdersTable";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listAdminOrders, type OrderListFilters } from "@/server/services/admin/orders";
import {
  FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type FulfillmentStatus,
  type OrderStatus,
  type PaymentStatus,
} from "@/server/domain/order-state";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Orders" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(allowed: readonly T[], v: string | undefined): T | undefined =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("order:view");
  const sp = await searchParams;
  const filters: OrderListFilters = {
    status: pick<OrderStatus>(ORDER_STATUSES, one(sp.status)),
    paymentStatus: pick<PaymentStatus>(PAYMENT_STATUSES, one(sp.payment)),
    fulfillmentStatus: pick<FulfillmentStatus>(FULFILLMENT_STATUSES, one(sp.fulfilment)),
    method: pick(["razorpay", "cod"] as const, one(sp.method)),
    from: date(one(sp.from)),
    to: date(one(sp.to)),
    q: one(sp.q)?.slice(0, 100) || undefined,
  };
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);
  const list = await listAdminOrders(getDb(), { ...filters, page });

  return (
    <>
      <PageHeader title="Orders" description="Every order, newest first. Click one to fulfil, refund or print." />
      <OrdersTable
        rows={list.items.map((o) => ({ ...o, placedAt: o.placedAt.toISOString() }))}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={list.pageSize}
        filters={{
          status: filters.status ?? "",
          payment: filters.paymentStatus ?? "",
          fulfilment: filters.fulfillmentStatus ?? "",
          method: filters.method ?? "",
          from: filters.from ?? "",
          to: filters.to ?? "",
          q: filters.q ?? "",
        }}
      />
    </>
  );
}
