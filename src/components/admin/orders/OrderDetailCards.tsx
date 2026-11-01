import { ExternalLink, FileText, Lock, Eye, Repeat2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/ui";
import { CaseStatusBadge, CaseTypeBadge, RESOLUTION_LABEL } from "@/components/admin/support/status";
import { formatINR } from "@/lib/money";
import type { AdminOrderDetail } from "@/server/services/admin/orders";
import { resolveImageUrl } from "@/server/services/media";

import { formatDateTime, statusWords } from "./status";

function safeImageUrl(path: string | null): string | null {
  if (!path) return null;
  try {
    return resolveImageUrl(path);
  } catch {
    return null;
  }
}

function Row({ label, value, strong, muted }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 text-[13px] ${strong ? "border-t border-admin-border pt-2 text-sm font-semibold" : ""} ${muted ? "text-admin-ink-muted" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

export function ItemsCard({ detail }: { detail: AdminOrderDetail }) {
  const { order, items } = detail;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Items</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Unit</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => {
              const url = safeImageUrl(i.imagePath);
              return (
                <TableRow key={i.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="relative size-10 shrink-0 overflow-hidden rounded-md border border-admin-border bg-admin-surface-2">
                        {url ? <Image src={url} alt="" fill sizes="40px" className="object-contain" unoptimized /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-admin-ink">{i.productName}</span>
                        <span className="block truncate text-xs text-admin-ink-muted">
                          {i.variantTitle !== "Default" ? `${i.variantTitle} · ` : ""}
                          <span className="font-mono">{i.sku}</span>
                          {i.hsn ? ` · HSN ${i.hsn}` : ""}
                          {i.gstRateBp !== null ? ` · GST ${i.gstRateBp / 100}%` : ""}
                        </span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right">{formatINR(i.unitPricePaise)}</TableCell>
                  <TableCell className="tabular text-right">{i.qty}</TableCell>
                  <TableCell className="tabular text-right">
                    {formatINR(i.lineTotalPaise)}
                    {i.discountAllocPaise > 0 ? (
                      <span className="block text-xs text-admin-ink-muted">-{formatINR(i.discountAllocPaise)} coupon</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <dl className="mt-4 ml-auto w-full max-w-xs">
          <Row label="Subtotal" value={formatINR(order.subtotalPaise)} />
          {order.discountPaise > 0 ? (
            <Row label={`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`} value={`-${formatINR(order.discountPaise)}`} />
          ) : null}
          <Row label="Shipping" value={order.shippingPaise > 0 ? formatINR(order.shippingPaise) : "Free"} />
          {order.codFeePaise > 0 ? <Row label="COD fee" value={formatINR(order.codFeePaise)} /> : null}
          <Row label="Total" value={formatINR(order.totalPaise)} strong />
          <Row label="Includes GST" value={formatINR(order.taxIncludedPaise)} muted />
        </dl>
      </CardContent>
    </Card>
  );
}

const REFUND_TONE = { pending: "warning", processed: "success", failed: "danger", manual: "info" } as const;
const DISPOSITION_LABEL = {
  duplicate: "Duplicate payment (being refunded)",
  no_stock: "Late payment, stock gone (being refunded)",
  order_closed: "Order was closed (being refunded)",
} as const;

export function PaymentsCard({ detail }: { detail: AdminOrderDetail }) {
  const { payments, refunds, money, order } = detail;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments and refunds</CardTitle>
        <CardDescription>
          {order.paymentMethod === "cod"
            ? "Cash on delivery: no online payment. Refunds are recorded by hand."
            : `Captured ${formatINR(money.capturedPaise)} · refunded ${formatINR(money.settledPaise)} · still refundable ${formatINR(money.refundablePaise)}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {payments.length > 0 ? (
          <ul className="divide-y divide-admin-border text-[13px]">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-mono text-xs text-admin-ink-muted">{p.providerPaymentId ?? p.providerOrderId}</span>
                  <span className="block text-xs text-admin-ink-muted">
                    {p.method ?? "no method yet"} · {formatDateTime(p.createdAt)}
                  </span>
                  {p.disposition ? <span className="block text-xs text-admin-danger">{DISPOSITION_LABEL[p.disposition]}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={p.status === "captured" ? "success" : p.status === "failed" ? "danger" : "neutral"}>{statusWords(p.status)}</Badge>
                  <span className="tabular font-medium">{formatINR(p.amountPaise)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : order.paymentMethod === "razorpay" ? (
          <p className="text-[13px] text-admin-ink-muted">No payment attempts recorded.</p>
        ) : null}

        {refunds.length > 0 ? (
          <div>
            <h4 className="mb-1 text-xs font-medium text-admin-ink-muted uppercase">Refunds</h4>
            <ul className="divide-y divide-admin-border text-[13px]">
              {refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block text-admin-ink">{r.reason ?? "Refund"}</span>
                    <span className="block text-xs text-admin-ink-muted">
                      {formatDateTime(r.createdAt)}
                      {r.actorName ? ` · ${r.actorName}` : ""}
                      {r.reference ? ` · ref ${r.reference}` : ""}
                      {r.providerRefundId ? ` · ${r.providerRefundId}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={REFUND_TONE[r.status]}>{r.status === "manual" ? "Manual" : statusWords(r.status)}</Badge>
                    <span className="tabular font-medium">{formatINR(r.amountPaise)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const EVENT_LABEL: Record<string, string> = {
  order_placed: "Order placed",
  order_confirmed: "Order confirmed",
  order_cancelled: "Order cancelled",
  order_expired: "Order expired",
  payment_captured: "Payment received",
  fulfillment_changed: "Fulfilment",
  shipment_added: "Shipment added",
  cod_collected: "COD collected",
  note: "Internal note",
  cancel_reason: "Cancellation reason",
  refund_initiated: "Refund initiated",
  refund_processed: "Refund processed",
  refund_failed: "Refund failed",
  stock_restocked: "Restocked",
  stock_reserved: "Stock reserved",
  stock_decremented: "Stock sold",
  stock_converted: "Stock sold",
  invoice_assigned: "Invoice number assigned",
  notification_resent: "E-mail re-sent",
  replacement_of: "Replacement order",
  replacement_created: "Replacement created",
};

export function TimelineCard({ detail, children }: { detail: AdminOrderDetail; children?: React.ReactNode }) {
  const events = [...detail.events].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>Newest first. “Customer sees” entries show on the customer&apos;s order page.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {children}
        <ol className="grid gap-0">
          {events.map((e) => (
            <li key={e.id} className="relative grid grid-cols-[1.25rem_1fr] gap-3 pb-4 last:pb-0">
              <span
                aria-hidden
                className={`mt-1 size-2.5 justify-self-center rounded-full ${e.type === "note" ? "bg-admin-warning" : e.visibleToCustomer ? "bg-admin-primary" : "bg-admin-border-strong"}`}
              />
              <div className="min-w-0 text-[13px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium text-admin-ink">{EVENT_LABEL[e.type] ?? statusWords(e.type)}</span>
                  {e.fromValue || e.toValue ? (
                    <span className="text-xs text-admin-ink-muted">
                      {e.fromValue ? `${statusWords(e.fromValue)} → ` : ""}
                      {e.toValue ? statusWords(e.toValue) : ""}
                    </span>
                  ) : null}
                  {e.visibleToCustomer ? (
                    <Badge tone="primary">
                      <Eye aria-hidden /> Customer sees
                    </Badge>
                  ) : (
                    <Badge tone="neutral">
                      <Lock aria-hidden /> Internal
                    </Badge>
                  )}
                </div>
                {e.note ? <p className="mt-0.5 whitespace-pre-wrap text-admin-ink-muted">{e.note}</p> : null}
                <p className="mt-0.5 text-xs text-admin-ink-faint">
                  {formatDateTime(e.createdAt)}
                  {e.actorName ? ` · ${e.actorName}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function CustomerCard({ detail, customerHref }: { detail: AdminOrderDetail; customerHref?: string }) {
  const { order } = detail;
  const a = (order.shippingAddress ?? {}) as Record<string, unknown>;
  const lines = [a.line1, a.line2, a.landmark, [a.city, a.pincode].filter(Boolean).join(" "), a.state]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-[13px]">
        <div>
          <p className="font-medium text-admin-ink">{detail.customerName || "Guest"}</p>
          <a href={`mailto:${order.email}`} className="flex min-h-6 items-center text-admin-primary hover:underline">
            {order.email}
          </a>
          {order.phone ? (
            <a href={`tel:${order.phone}`} className="flex min-h-6 items-center text-admin-ink-muted hover:underline">
              {order.phone}
            </a>
          ) : null}
        </div>
        <div>
          <h4 className="mb-0.5 text-xs font-medium text-admin-ink-muted uppercase">Ship to</h4>
          <address className="not-italic text-admin-ink">
            {lines.map((l, i) => (
              <span key={i} className="block">
                {l}
              </span>
            ))}
          </address>
        </div>
        <p className="text-xs text-admin-ink-muted">
          {order.userId ? "Signed-in customer" : "Guest checkout"} · placed {formatDateTime(order.placedAt)}
          {order.vibeAtOrder ? ` · vibe ${order.vibeAtOrder}` : ""}
        </p>
        {customerHref ? (
          <Link href={customerHref} className="text-admin-primary hover:underline">
            View customer
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** "Replacement for IFO-…" / "Replacement order IFO-…" links, shown in the page header. */
export function ReplacementLinks({ detail }: { detail: AdminOrderDetail }) {
  const { replacementFor, replacements } = detail;
  if (!replacementFor && replacements.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
      {replacementFor ? (
        <Link
          href={`/admin/orders/${replacementFor.orderId}`}
          className="inline-flex items-center gap-1 rounded-md bg-admin-primary-soft px-2 py-0.5 font-medium text-admin-primary hover:underline"
        >
          <Repeat2 className="size-3.5" aria-hidden />
          Replacement for <span className="font-mono">{replacementFor.ref}</span>
        </Link>
      ) : null}
      {replacements.map((r) => (
        <Link
          key={r.orderId}
          href={`/admin/orders/${r.orderId}`}
          className="inline-flex items-center gap-1 rounded-md bg-admin-primary-soft px-2 py-0.5 font-medium text-admin-primary hover:underline"
        >
          <Repeat2 className="size-3.5" aria-hidden />
          Replacement order <span className="font-mono">{r.ref}</span>
        </Link>
      ))}
    </span>
  );
}

const caseShortId = (id: string) => id.slice(0, 8).toUpperCase();

/** Support cases reported on this order, and the replacement orders they led to. */
export function SupportLinksCard({ detail, canViewSupport }: { detail: AdminOrderDetail; canViewSupport: boolean }) {
  const { supportCases, replacementFor, replacements } = detail;
  if (supportCases.length === 0 && !replacementFor && replacements.length === 0) return null;
  const replacementByCase = new Map(replacements.map((r) => [r.caseId, r]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Support and replacements</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-[13px]">
        {replacementFor ? (
          <p>
            Replacement for{" "}
            <Link href={`/admin/orders/${replacementFor.orderId}`} className="font-mono text-admin-primary hover:underline">
              {replacementFor.ref}
            </Link>
            {canViewSupport ? (
              <>
                {" "}
                (case{" "}
                <Link href={`/admin/support/cases/${replacementFor.caseId}`} className="font-mono text-admin-primary hover:underline">
                  {caseShortId(replacementFor.caseId)}
                </Link>
                )
              </>
            ) : null}
            . No charge.
          </p>
        ) : null}
        {supportCases.length > 0 ? (
          <ul className="divide-y divide-admin-border">
            {supportCases.map((c) => {
              const replacement = replacementByCase.get(c.id);
              return (
                <li key={c.id} className="grid gap-1 py-2 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {canViewSupport ? (
                      <Link href={`/admin/support/cases/${c.id}`} className="font-mono font-medium text-admin-primary hover:underline">
                        {caseShortId(c.id)}
                      </Link>
                    ) : (
                      <span className="font-mono font-medium">{caseShortId(c.id)}</span>
                    )}
                    <CaseTypeBadge type={c.type} />
                    <CaseStatusBadge status={c.status} />
                  </div>
                  <p className="text-xs text-admin-ink-muted">
                    {formatDateTime(c.createdAt)}
                    {c.resolution ? ` · ${RESOLUTION_LABEL[c.resolution]}` : ""}
                  </p>
                  {replacement ? (
                    <p>
                      Replacement order{" "}
                      <Link href={`/admin/orders/${replacement.orderId}`} className="font-mono text-admin-primary hover:underline">
                        {replacement.ref}
                      </Link>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ShipmentsCard({ detail }: { detail: AdminOrderDetail }) {
  if (detail.shipments.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Shipments</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-[13px]">
        {detail.shipments.map((s) => (
          <div key={s.id} className="grid gap-0.5">
            <p className="flex items-center gap-2 font-medium text-admin-ink">
              {s.courier}
              <Badge tone={s.status === "delivered" ? "success" : "primary"}>{statusWords(s.status)}</Badge>
            </p>
            {s.awb ? <p className="font-mono text-xs text-admin-ink-muted">AWB {s.awb}</p> : null}
            {s.trackingUrl ? (
              <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-admin-primary hover:underline">
                Track parcel <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
            <p className="text-xs text-admin-ink-faint">
              {s.shippedAt ? `Shipped ${formatDateTime(s.shippedAt)}` : ""}
              {s.deliveredAt ? ` · delivered ${formatDateTime(s.deliveredAt)}` : ""}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function DocumentsCard({
  detail,
  canInvoice,
  canPackingSlip,
}: {
  detail: AdminOrderDetail;
  canInvoice: boolean;
  canPackingSlip: boolean;
}) {
  const inv = detail.invoice;
  const confirmed = ["confirmed", "processing", "completed"].includes(detail.order.status);
  if (!canInvoice && !canPackingSlip) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-[13px]">
        {canPackingSlip ? (
          <a
            href={`/admin/orders/${detail.order.id}/packing-slip`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-admin-primary hover:underline"
          >
            <FileText className="size-4" aria-hidden /> Packing slip (no prices)
          </a>
        ) : null}
        {canInvoice ? (
          inv || confirmed ? (
            <a
              href={`/api/admin/orders/${detail.order.id}/invoice`}
              className="inline-flex items-center gap-2 text-admin-primary hover:underline"
            >
              <FileText className="size-4" aria-hidden />
              {inv ? `${inv.kind === "tax_invoice" ? "Tax invoice" : "Bill of supply"} ${inv.number}` : "Invoice"}
              <span className="text-xs text-admin-ink-muted">PDF</span>
            </a>
          ) : (
            <p className="text-admin-ink-muted">An invoice is issued once the order is confirmed.</p>
          )
        ) : null}
        {detail.notifications.length > 0 ? (
          <div className="mt-2 border-t border-admin-border pt-2">
            <h4 className="mb-1 text-xs font-medium text-admin-ink-muted uppercase">E-mails</h4>
            <ul className="grid gap-0.5 text-xs text-admin-ink-muted">
              {detail.notifications.map((n) => (
                <li key={n.id} className="flex justify-between gap-2">
                  <span>{statusWords(n.template)}</span>
                  <span>{n.status}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
