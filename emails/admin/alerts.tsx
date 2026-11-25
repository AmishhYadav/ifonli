import { formatINR } from "@/lib/money";
import { formatIstDateTime } from "@/server/domain/ist";

import { Layout, FONT_STACK } from "../layout";
import { Cta, Facts, P } from "../parts";
import type { TemplateProps } from "../payloads";
import { paletteFor } from "../theme";
import type { EmailContext } from "../types";

/** Admin links live under /admin; order pages are addressed by id. */
const adminOrderHref = (ctx: EmailContext, orderId: string) => `${ctx.siteUrl}/admin/orders/${orderId}`;

export function NewOrder({ payload, ctx }: TemplateProps<"new_order">) {
  return (
    <Layout ctx={ctx} preview={`${payload.ref}: ${formatINR(payload.totalPaise)}`} heading="New order">
      <Facts
        rows={[
          ["Order", payload.ref],
          ["Total", formatINR(payload.totalPaise)],
          ["Payment", payload.paymentMethod === "cod" ? "Cash on delivery" : "Paid online"],
          ...(payload.late ? ([["Note", "Paid after the reservation expired; stock was still available"]] as [string, string][]) : []),
        ]}
        ctx={ctx}
      />
      {payload.orderId ? <Cta href={adminOrderHref(ctx, payload.orderId)} ctx={ctx}>Open order</Cta> : null}
    </Layout>
  );
}

export const ANOMALY_LABEL: Record<string, string> = {
  duplicate: "Duplicate payment (refunded)",
  no_stock: "Paid after items sold out (refunded)",
  order_closed: "Payment on a closed order (refunded)",
  amount_mismatch: "Captured amount does not match the order",
  refund_failed: "Refund failed at the payment provider",
};

export function PaymentAnomaly({ payload, ctx }: TemplateProps<"payment_anomaly">) {
  const label = ANOMALY_LABEL[payload.kind] ?? payload.kind;
  const rows: [string, string][] = [
    ["Issue", label],
    ["Order", payload.ref],
  ];
  if (payload.providerPaymentId) rows.push(["Payment id", payload.providerPaymentId]);
  if (payload.refundId) rows.push(["Refund id", payload.refundId]);
  if (payload.amountPaise !== undefined) rows.push(["Amount", formatINR(payload.amountPaise)]);
  if (payload.capturedPaise !== undefined) rows.push(["Captured", formatINR(payload.capturedPaise)]);
  if (payload.orderTotalPaise !== undefined) rows.push(["Order total", formatINR(payload.orderTotalPaise)]);
  return (
    <Layout ctx={ctx} preview={`${label} (${payload.ref})`} heading="Payment needs a look">
      <Facts rows={rows} ctx={ctx} />
      {payload.kind === "refund_failed" || payload.kind === "amount_mismatch" ? (
        <P ctx={ctx}>The money did not move the way it should have. Please review this order and act on it.</P>
      ) : (
        <P ctx={ctx} muted>
          This was handled automatically. It is here so you know it happened.
        </P>
      )}
      {payload.orderId ? <Cta href={adminOrderHref(ctx, payload.orderId)} ctx={ctx}>Open order</Cta> : null}
    </Layout>
  );
}

export function NewSupportCase({ payload, ctx }: TemplateProps<"new_support_case">) {
  return (
    <Layout ctx={ctx} preview={`${payload.type} issue on ${payload.ref}`} heading="New support case">
      <Facts
        rows={[
          ["Order", payload.ref],
          ["Type", payload.type],
        ]}
        ctx={ctx}
      />
      <P ctx={ctx} style={{ whiteSpace: "pre-line" }}>
        {payload.description}
      </P>
      <Cta href={`${ctx.siteUrl}/admin/support`} ctx={ctx}>Open support</Cta>
    </Layout>
  );
}

export function NewContact({ payload, ctx }: TemplateProps<"new_contact">) {
  const rows: [string, string][] = [
    ["From", `${payload.name} <${payload.email}>`],
  ];
  if (payload.orderRef) rows.push(["Order", payload.orderRef]);
  return (
    <Layout ctx={ctx} preview={`Message from ${payload.name}`} heading="New contact message">
      <Facts rows={rows} ctx={ctx} />
      <P ctx={ctx} style={{ whiteSpace: "pre-line" }}>
        {payload.message}
      </P>
      <Cta href={`${ctx.siteUrl}/admin/support`} ctx={ctx}>Open support</Cta>
    </Layout>
  );
}

export function OutboxFailure({ payload, ctx }: TemplateProps<"outbox_failure">) {
  return (
    <Layout ctx={ctx} preview={`Could not send "${payload.template}" after ${payload.attempts} tries`} heading="An email could not be sent">
      <P ctx={ctx}>
        We gave up sending an email after {payload.attempts} attempts. The customer has not received it.
      </P>
      <Facts
        rows={[
          ["Email", payload.template],
          ...(payload.orderRef ? ([["Order", payload.orderRef]] as [string, string][]) : []),
          ["Outbox id", payload.outboxId],
          ["Last error", payload.error],
        ]}
        ctx={ctx}
      />
      <P ctx={ctx} muted>
        Check the email provider status and the sending domain. For an order email, you can re-send it from the order page.
      </P>
    </Layout>
  );
}

export function LowStockDigest({ payload, ctx }: TemplateProps<"low_stock_digest">) {
  const c = paletteFor(ctx.vibe);
  const td = { fontFamily: FONT_STACK, fontSize: 14, lineHeight: "20px", padding: "8px 6px", borderBottom: `1px solid ${c.surfaceAlt}`, color: c.ink, verticalAlign: "top" as const };
  const out = payload.rows.filter((r) => r.available <= 0).length;
  const more = payload.total - payload.rows.length;
  return (
    <Layout
      ctx={ctx}
      preview={`${payload.total} variant${payload.total === 1 ? "" : "s"} low or sold out`}
      heading="Low stock"
    >
      <P ctx={ctx}>
        {payload.total} variant{payload.total === 1 ? " is" : "s are"} at or below the low-stock level
        {out > 0 ? `, ${out} sold out` : ""}.
      </P>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={{ margin: "0 0 16px" }}>
        <thead>
          <tr>
            {["Product", "SKU", "Left"].map((h, i) => (
              <th key={h} align={i === 2 ? "right" : "left"} style={{ ...td, color: c.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payload.rows.map((r) => (
            <tr key={r.sku}>
              <td style={td}>
                <strong>{r.productName}</strong>
                {r.variantTitle ? <span style={{ color: c.muted }}> ({r.variantTitle})</span> : null}
              </td>
              <td style={{ ...td, color: c.muted, wordBreak: "break-all" }}>{r.sku}</td>
              <td align="right" style={{ ...td, fontWeight: 800, color: r.available <= 0 ? c.danger : c.ink, whiteSpace: "nowrap" }}>
                {r.available <= 0 ? "Sold out" : `${r.available} / ${r.threshold}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 ? (
        <P ctx={ctx} muted>
          and {more} more. See the inventory page for the full list.
        </P>
      ) : null}
      <Cta href={`${ctx.siteUrl}/admin/inventory`} ctx={ctx}>Open inventory</Cta>
    </Layout>
  );
}

/** Prints an ISO instant in IST; falls back to the raw text for a value that is not a date. */
function istTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatIstDateTime(d);
}

export function AdminLoginLocked({ payload, ctx }: TemplateProps<"admin_login_locked">) {
  return (
    <Layout ctx={ctx} preview={`Sign-in locked for ${payload.account}`} heading="Admin sign-in locked">
      <P ctx={ctx}>
        {payload.scope === "address"
          ? `Sign-in for the admin account ${payload.account} was locked for the address below after ${payload.failures} wrong passwords from it. Until the lock ends, every attempt from that address is refused, even with the right password. Sign-in from other addresses still works.`
          : `Sign-in for the admin account ${payload.account} was locked after ${payload.failures} wrong passwords from several addresses. Until the lock ends, every sign-in attempt for this account is refused, even with the right password.`}
      </P>
      <Facts
        rows={[
          ["Account", payload.account],
          ["Wrong passwords", String(payload.failures)],
          ["Locked at", istTime(payload.at)],
          ["Works again", istTime(payload.lockedUntil)],
          ["Locked for", payload.scope === "address" ? "This address only" : "Every address"],
          ["Last address", payload.ip ?? "unknown"],
        ]}
        ctx={ctx}
      />
      <P ctx={ctx} muted>
        If this was you, wait until the time above. If it was not, someone is guessing this password: the account is safe
        for now (they also need the authenticator code), but ask an owner to reset the password under Admin, Users. An
        owner can lift the lock early; see the runbook section on rate limits.
      </P>
    </Layout>
  );
}

export function AdminNewSignIn({ payload, ctx }: TemplateProps<"admin_new_sign_in">) {
  return (
    <Layout ctx={ctx} preview="New sign-in to your IfOnli admin account" heading="New sign-in to your IfOnli admin account">
      <P ctx={ctx}>
        The admin account {payload.account} was just signed in to from an address not seen in the last 30 days.
      </P>
      <Facts
        rows={[
          ["Account", `${payload.account} (${payload.role})`],
          ["Time", istTime(payload.at)],
          ["IP address", payload.ip ?? "unknown"],
          ["Browser", payload.userAgent ?? "unknown"],
        ]}
        ctx={ctx}
      />
      <P ctx={ctx}>
        If this was you, there is nothing to do. If this was not you, ask an owner to revoke your sessions and reset your
        password and two-factor (Admin, Users).
      </P>
    </Layout>
  );
}
