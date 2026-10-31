import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { formatDateTime } from "@/components/admin/orders/status";
import {
  FulfilmentBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/admin/orders/status";
import { AssignControl } from "@/components/admin/support/AssignControl";
import { ComposeCard } from "@/components/admin/support/ComposeCard";
import { MessageStatusControl } from "@/components/admin/support/MessageStatusControl";
import { SupportTimeline } from "@/components/admin/support/SupportTimeline";
import { ContactStatusBadge } from "@/components/admin/support/status";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components/admin/ui";
import { formatINR } from "@/lib/money";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import type { FulfillmentStatus, OrderStatus, PaymentStatus } from "@/server/domain/order-state";
import { getContactMessageDetail, listAssignableStaff } from "@/server/services/admin/support";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Message" };

export default async function ContactMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin("support:view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const [detail, staff] = await Promise.all([
    getContactMessageDetail(db, id),
    listAssignableStaff(db),
  ]);
  if (!detail) notFound();

  const role = session.user.role;
  const m = detail.message;
  const respond = can(role, "support:respond");
  const order = detail.order;

  return (
    <>
      <PageHeader
        back={{ href: "/admin/support", label: "Inbox" }}
        title={m.name}
        description={`${m.email}${m.phone ? ` · ${m.phone}` : ""}`}
        badges={<ContactStatusBadge status={m.status} />}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Message</CardTitle>
              <CardDescription>
                Received {formatDateTime(m.createdAt)}
                {detail.otherMessages > 0
                  ? ` · ${detail.otherMessages} other message(s) from this e-mail address`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-[13px] whitespace-pre-wrap text-admin-ink">{m.message}</p>
            </CardContent>
          </Card>
          {respond ? (
            <ComposeCard
              kind="message"
              id={m.id}
              customerEmail={m.email}
              replyDisabledReason={
                m.status === "closed" ? "This message is closed. Re-open it to reply." : undefined
              }
            />
          ) : null}
          <SupportTimeline entries={detail.timeline} />
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <MessageStatusControl
            id={m.id}
            status={m.status}
            allowed={detail.allowedStatuses}
            disabled={!respond}
          />
          <AssignControl
            kind="message"
            id={m.id}
            assignedTo={m.assignedTo}
            staff={staff.map((s) => ({ id: s.id, name: s.name, role: s.role }))}
            meId={session.user.id}
            disabled={!respond}
          />
          <Card>
            <CardHeader>
              <CardTitle>Order</CardTitle>
              <CardDescription>
                {m.orderRef
                  ? `The customer wrote “${m.orderRef}”.`
                  : "No order reference was given."}
              </CardDescription>
            </CardHeader>
            {m.orderRef ? (
              <CardContent className="grid gap-2 text-[13px]">
                {order ? (
                  <>
                    <p className="flex flex-wrap items-center gap-2">
                      {can(role, "order:view") ? (
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="font-mono text-admin-primary hover:underline"
                        >
                          {order.ref}
                        </Link>
                      ) : (
                        <span className="font-mono">{order.ref}</span>
                      )}
                      <span className="tabular text-admin-ink-muted">
                        {formatINR(order.totalPaise)}
                      </span>
                    </p>
                    <span className="flex flex-wrap items-center gap-1">
                      <OrderStatusBadge status={order.status as OrderStatus} />
                      <PaymentStatusBadge status={order.paymentStatus as PaymentStatus} />
                      <FulfilmentBadge status={order.fulfillmentStatus as FulfillmentStatus} />
                    </span>
                    <p className="text-xs text-admin-ink-muted">
                      Placed {formatDateTime(order.placedAt)}
                    </p>
                    {order.emailMatches ? (
                      <Badge tone="success">Same e-mail as the order</Badge>
                    ) : (
                      <Badge tone="warning">
                        E-mail differs from the order: check before sharing details
                      </Badge>
                    )}
                  </>
                ) : (
                  <p className="text-admin-ink-muted">No order has that reference.</p>
                )}
              </CardContent>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
