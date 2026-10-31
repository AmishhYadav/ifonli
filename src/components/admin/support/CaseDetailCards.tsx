import { ExternalLink, FileText, ImageOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { formatDateTime } from "@/components/admin/orders/status";
import { FulfilmentBadge, MethodBadge, OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/orders/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/admin/ui";
import { formatINR } from "@/lib/money";
import type { AdminOrderDetail } from "@/server/services/admin/orders";
import type { CasePhoto, SupportCaseDetail } from "@/server/services/admin/support";

import { CaseStatusBadge, CaseTypeBadge, ResolutionBadge } from "./status";

export function CaseSummaryCard({ detail }: { detail: SupportCaseDetail }) {
  const c = detail.case;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <CaseTypeBadge type={c.type} />
          <CaseStatusBadge status={c.status} />
          {c.resolution ? <ResolutionBadge resolution={c.resolution} /> : null}
        </CardTitle>
        <CardDescription>Reported {formatDateTime(c.createdAt)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div>
          <h4 className="mb-1 text-xs font-medium text-admin-ink-muted uppercase">What the customer said</h4>
          <p className="text-[13px] whitespace-pre-wrap text-admin-ink">{c.description}</p>
        </div>
        {c.notes ? (
          <div>
            <h4 className="mb-1 text-xs font-medium text-admin-ink-muted uppercase">Case notes</h4>
            <p className="text-[13px] whitespace-pre-wrap text-admin-ink">{c.notes}</p>
          </div>
        ) : null}
        {detail.replacementOrder ? (
          <p className="text-[13px]">
            Replacement order{" "}
            <Link href={`/admin/orders/${detail.replacementOrder.id}`} className="font-mono text-admin-primary hover:underline">
              {detail.replacementOrder.ref}
            </Link>{" "}
            <span className="text-admin-ink-muted">({detail.replacementOrder.fulfillmentStatus.replace(/_/g, " ")})</span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CasePhotosCard({ photos }: { photos: CasePhoto[] }) {
  const noPreview = photos.some((p) => p.url === null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Photos</CardTitle>
        <CardDescription>
          {photos.length === 0
            ? "The customer did not attach any photos."
            : "Private files. The links expire after 10 minutes: reload the page for fresh ones."}
        </CardDescription>
      </CardHeader>
      {photos.length > 0 ? (
        <CardContent className="grid gap-3">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((p) => (
              <li key={p.path} className="min-w-0">
                {p.url ? (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block overflow-hidden rounded-md border border-admin-border bg-admin-surface-2"
                  >
                    {p.isImage ? (
                      <span className="relative block aspect-square">
                        <Image src={p.url} alt={`Customer photo ${p.name}`} fill sizes="200px" className="object-cover" unoptimized />
                      </span>
                    ) : (
                      <span className="flex aspect-square items-center justify-center text-admin-ink-muted">
                        <FileText className="size-8" aria-hidden />
                      </span>
                    )}
                    <span className="flex items-center justify-between gap-1 px-2 py-1 text-xs text-admin-primary group-hover:underline">
                      <span className="truncate">{p.name}</span>
                      <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </span>
                  </a>
                ) : (
                  <span className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-admin-border-strong bg-admin-surface-2 p-2 text-center text-xs text-admin-ink-muted">
                    <ImageOff className="size-6" aria-hidden />
                    <span>Preview unavailable</span>
                    <span className="max-w-full truncate font-mono">{p.name}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {noPreview ? (
            <p role="status" className="text-xs text-admin-ink-muted">
              Some photos can&apos;t be shown because file storage isn&apos;t reachable from here. The case itself still works.
            </p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function CaseOrderCard({ order }: { order: AdminOrderDetail }) {
  const o = order.order;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Link href={`/admin/orders/${o.id}`} className="font-mono text-admin-primary hover:underline">
            {o.ref}
          </Link>
        </CardTitle>
        <CardDescription>
          {order.customerName || "Guest"} · {o.email}
          {o.phone ? ` · ${o.phone}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-[13px]">
        <span className="flex flex-wrap items-center gap-1">
          <OrderStatusBadge status={o.status} />
          <PaymentStatusBadge status={o.paymentStatus} />
          <FulfilmentBadge status={o.fulfillmentStatus} />
          <MethodBadge method={o.paymentMethod} />
        </span>
        <ul className="divide-y divide-admin-border">
          {order.items.map((i) => (
            <li key={i.id} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="block truncate text-admin-ink">{i.productName}</span>
                <span className="block truncate text-xs text-admin-ink-muted">
                  {i.variantTitle !== "Default" ? `${i.variantTitle} · ` : ""}
                  <span className="font-mono">{i.sku}</span>
                </span>
              </span>
              <span className="tabular shrink-0 text-admin-ink-muted">
                {i.qty} × {formatINR(i.unitPricePaise)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="grid gap-0.5">
          <div className="flex justify-between gap-3">
            <dt className="text-admin-ink-muted">Order total</dt>
            <dd className="tabular font-medium">{formatINR(o.totalPaise)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-admin-ink-muted">Refunded so far</dt>
            <dd className="tabular">{formatINR(order.money.settledPaise)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-admin-ink-muted">Still refundable</dt>
            <dd className="tabular">{formatINR(order.money.refundablePaise)}</dd>
          </div>
        </dl>
        {order.refunds.length > 0 ? (
          <ul className="grid gap-0.5 text-xs text-admin-ink-muted">
            {order.refunds.map((r) => (
              <li key={r.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{r.reason ?? "Refund"}</span>
                <span className="tabular shrink-0">
                  {formatINR(r.amountPaise)} · {r.status}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-admin-ink-muted">Placed {formatDateTime(o.placedAt)}</p>
      </CardContent>
    </Card>
  );
}
