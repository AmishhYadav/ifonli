import { Heart, Repeat2 } from "lucide-react";
import Link from "next/link";

import {
  FulfilmentBadge,
  MethodBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
  formatDate,
  formatDateTime,
} from "@/components/admin/orders/status";
import {
  CaseStatusBadge,
  CaseTypeBadge,
  ContactStatusBadge,
} from "@/components/admin/support/status";
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
import { formatINR } from "@/lib/money";
import type { CustomerDetail } from "@/server/services/admin/customers";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-[13px]">
      <dt className="text-admin-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right text-admin-ink">{children}</dd>
    </div>
  );
}

const caseShortId = (id: string) => id.slice(0, 8).toUpperCase();

export function ProfileCard({ detail }: { detail: CustomerDetail }) {
  const a = detail.account;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          {a
            ? "A customer account with a login."
            : "Ordered as a guest: no account, so no saved addresses or wishlist."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-admin-border">
          <Row label="Name">{detail.name || "-"}</Row>
          <Row label="E-mail">
            <a
              href={`mailto:${detail.email}`}
              className="break-all text-admin-primary hover:underline"
            >
              {detail.email}
            </a>
            {a ? (
              <span className="ml-1.5 text-xs text-admin-ink-muted">
                {a.emailVerified ? "verified" : "not verified"}
              </span>
            ) : null}
          </Row>
          <Row label="Phone">
            {detail.phone ? (
              <a href={`tel:${detail.phone}`} className="text-admin-primary hover:underline">
                {detail.phone}
              </a>
            ) : (
              "-"
            )}
          </Row>
          {a ? (
            <>
              <Row label="Marketing e-mails">{a.marketingOptIn ? "Opted in" : "Not opted in"}</Row>
              <Row label="Joined">{formatDateTime(a.createdAt)}</Row>
              <Row label="Last sign-in">
                {a.lastSignInAt ? formatDateTime(a.lastSignInAt) : "No session on record"}
              </Row>
              {a.banned ? (
                <Row label="Status">
                  <Badge tone="danger">Blocked</Badge>
                </Row>
              ) : null}
            </>
          ) : (
            <Row label="First order">
              {detail.firstOrderAt ? formatDateTime(detail.firstOrderAt) : "-"}
            </Row>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

export function StatsCard({ detail }: { detail: CustomerDetail }) {
  const { stats } = detail;
  const avg = stats.orderCount > 0 ? Math.round(stats.lifetimeValuePaise / stats.orderCount) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifetime</CardTitle>
        <CardDescription>
          Confirmed orders only: cancelled, refunded and no-charge replacement orders are left out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-admin-border">
          <Row label="Orders">{stats.orderCount}</Row>
          <Row label="Total spent">
            <span className="tabular font-semibold">{formatINR(stats.lifetimeValuePaise)}</span>
          </Row>
          <Row label="Average order">{avg === null ? "-" : formatINR(avg)}</Row>
          <Row label="Last order">
            {stats.lastOrderAt ? formatDate(stats.lastOrderAt) : "Never"}
          </Row>
          {detail.account ? (
            <Row label="Wishlist">
              <span className="inline-flex items-center gap-1">
                <Heart className="size-3.5" aria-hidden /> {detail.wishlistCount} saved
              </span>
            </Row>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

export function AddressesCard({ detail }: { detail: CustomerDetail }) {
  if (!detail.account) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Saved addresses</CardTitle>
      </CardHeader>
      <CardContent>
        {detail.addresses.length === 0 ? (
          <p className="text-[13px] text-admin-ink-muted">No saved addresses.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {detail.addresses.map((a) => (
              <li key={a.id} className="rounded-md border border-admin-border p-3 text-[13px]">
                <p className="flex items-center gap-2 font-medium text-admin-ink">
                  {a.name}
                  {a.isDefault ? <Badge tone="primary">Default</Badge> : null}
                </p>
                <address className="mt-1 text-admin-ink-muted not-italic">
                  {[a.line1, a.line2, a.landmark].filter(Boolean).map((l, i) => (
                    <span key={i} className="block">
                      {l}
                    </span>
                  ))}
                  <span className="block">
                    {a.city} {a.pincode}
                  </span>
                  <span className="block">{a.state}</span>
                </address>
                <p className="mt-1 text-xs text-admin-ink-muted">{a.phone}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OrdersCard({
  detail,
  canViewOrders,
}: {
  detail: CustomerDetail;
  canViewOrders: boolean;
}) {
  const { orders, ordersTotal } = detail;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
        <CardDescription>
          {orders.length === 0
            ? "No orders yet."
            : ordersTotal > orders.length
              ? `Latest ${orders.length} of ${ordersTotal}, newest first.`
              : "Newest first."}
        </CardDescription>
      </CardHeader>
      {orders.length > 0 ? (
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    {canViewOrders ? (
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="font-mono text-[13px] font-medium text-admin-primary hover:underline"
                      >
                        {o.ref}
                      </Link>
                    ) : (
                      <span className="font-mono text-[13px] font-medium">{o.ref}</span>
                    )}
                    <span className="block text-xs text-admin-ink-muted">
                      {formatDateTime(o.placedAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      <OrderStatusBadge status={o.status} />
                      <PaymentStatusBadge status={o.paymentStatus} />
                      <FulfilmentBadge status={o.fulfillmentStatus} />
                      <MethodBadge method={o.paymentMethod} />
                      {o.isReplacement ? (
                        <Badge tone="primary">
                          <Repeat2 aria-hidden /> Replacement
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="tabular text-right">{formatINR(o.totalPaise)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function SupportCard({
  detail,
  canViewSupport,
}: {
  detail: CustomerDetail;
  canViewSupport: boolean;
}) {
  const { supportCases, contactMessages } = detail;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Support</CardTitle>
        <CardDescription>
          Problems reported on this customer&apos;s orders and messages sent from the Help page.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-[13px]">
        <div>
          <h4 className="mb-1 text-xs font-medium text-admin-ink-muted uppercase">Cases</h4>
          {supportCases.length === 0 ? (
            <p className="text-admin-ink-muted">No support cases.</p>
          ) : (
            <ul className="divide-y divide-admin-border">
              {supportCases.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {canViewSupport ? (
                      <Link
                        href={`/admin/support/cases/${c.id}`}
                        className="font-mono font-medium text-admin-primary hover:underline"
                      >
                        {caseShortId(c.id)}
                      </Link>
                    ) : (
                      <span className="font-mono font-medium">{caseShortId(c.id)}</span>
                    )}
                    <CaseTypeBadge type={c.type} />
                    <CaseStatusBadge status={c.status} />
                  </span>
                  <span className="text-xs text-admin-ink-muted">
                    <span className="font-mono">{c.orderRef}</span> · {formatDate(c.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="mb-1 text-xs font-medium text-admin-ink-muted uppercase">
            Contact messages
          </h4>
          {contactMessages.length === 0 ? (
            <p className="text-admin-ink-muted">No messages.</p>
          ) : (
            <ul className="divide-y divide-admin-border">
              {contactMessages.map((m) => (
                <li key={m.id} className="grid gap-0.5 py-2">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {canViewSupport ? (
                      <Link
                        href={`/admin/support/messages/${m.id}`}
                        className="font-medium text-admin-primary hover:underline"
                      >
                        {m.snippet}
                      </Link>
                    ) : (
                      <span className="font-medium">{m.snippet}</span>
                    )}
                    <ContactStatusBadge status={m.status} />
                  </span>
                  <span className="text-xs text-admin-ink-muted">
                    {formatDate(m.createdAt)}
                    {m.orderRef ? (
                      <>
                        {" "}
                        · about <span className="font-mono">{m.orderRef}</span>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
