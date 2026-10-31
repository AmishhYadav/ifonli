import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AssignControl } from "@/components/admin/support/AssignControl";
import { CaseActionsPanel } from "@/components/admin/support/CaseActionsPanel";
import {
  CaseOrderCard,
  CasePhotosCard,
  CaseSummaryCard,
} from "@/components/admin/support/CaseDetailCards";
import { ComposeCard } from "@/components/admin/support/ComposeCard";
import { SupportTimeline } from "@/components/admin/support/SupportTimeline";
import { CaseStatusBadge } from "@/components/admin/support/status";
import { PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import {
  getSupportCaseDetail,
  listAssignableStaff,
  signCasePhotos,
} from "@/server/services/admin/support";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Support case" };

export default async function SupportCasePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin("support:view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const detail = await getSupportCaseDetail(db, id);
  if (!detail) notFound();
  const [photos, staff] = await Promise.all([
    signCasePhotos(detail.case.photoPaths),
    listAssignableStaff(db),
  ]);

  const role = session.user.role;
  const { order } = detail;
  const canOrderView = can(role, "order:view");
  const allow = {
    respond: can(role, "support:respond"),
    resolve: can(role, "support:resolve"),
    refund: can(role, "order:refund"),
  };

  return (
    <>
      <PageHeader
        back={{ href: "/admin/support?tab=cases", label: "Cases" }}
        title={<span className="font-mono">Case {detail.shortId}</span>}
        description={`${order.customerName || "Guest"} · ${order.order.email} · order ${order.order.ref}`}
        badges={<CaseStatusBadge status={detail.case.status} />}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-5">
          <CaseSummaryCard detail={detail} />
          <CasePhotosCard photos={photos} />
          {allow.respond ? (
            <ComposeCard kind="case" id={detail.case.id} customerEmail={order.order.email} />
          ) : null}
          <SupportTimeline entries={detail.timeline} />
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <CaseActionsPanel
            caseId={detail.case.id}
            shortId={detail.shortId}
            orderRef={order.order.ref}
            status={detail.case.status}
            paymentMethod={order.order.paymentMethod}
            items={order.items.map((i) => ({
              id: i.id,
              name:
                i.variantTitle !== "Default"
                  ? `${i.productName} (${i.variantTitle})`
                  : i.productName,
              sku: i.sku,
              qty: i.qty,
            }))}
            refundablePaise={order.money.refundablePaise}
            canReplace={["confirmed", "processing", "completed"].includes(order.order.status)}
            allow={allow}
          />
          <AssignControl
            kind="case"
            id={detail.case.id}
            assignedTo={detail.case.assignedTo}
            staff={staff.map((s) => ({ id: s.id, name: s.name, role: s.role }))}
            meId={session.user.id}
            disabled={!allow.respond}
          />
          <CaseOrderCard order={order} />
          {canOrderView ? (
            <Link
              href={`/admin/orders/${order.order.id}`}
              className="text-[13px] text-admin-primary hover:underline"
            >
              Open the full order
            </Link>
          ) : null}
          {detail.siblingCases.length > 0 ? (
            <section aria-label="Other cases on this order" className="text-[13px]">
              <h2 className="mb-1 text-xs font-medium text-admin-ink-muted uppercase">
                Other cases on this order
              </h2>
              <ul className="grid gap-0.5">
                {detail.siblingCases.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/admin/support/cases/${s.id}`}
                      className="font-mono text-admin-primary hover:underline"
                    >
                      {s.shortId}
                    </Link>{" "}
                    <span className="text-admin-ink-muted">
                      {s.type} · {s.status.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
