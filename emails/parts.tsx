import { Button, Link } from "react-email";
import type { CSSProperties, ReactNode } from "react";

import { formatINR } from "@/lib/money";

import { FONT_STACK } from "./layout";
import { paletteFor } from "./theme";
import type { EmailContext, OrderView } from "./types";

/** Body paragraph. */
export function P({ children, muted, ctx, style }: { children: ReactNode; muted?: boolean; ctx: EmailContext; style?: CSSProperties }) {
  const c = paletteFor(ctx.vibe);
  return (
    <p style={{ margin: "0 0 16px", fontFamily: FONT_STACK, fontSize: muted ? 14 : 16, lineHeight: muted ? "21px" : "24px", color: muted ? c.muted : c.ink, ...style }}>
      {children}
    </p>
  );
}

/** Call-to-action button (an anchor styled as a button; Outlook-safe padding via react-email). */
export function Cta({ href, children, ctx }: { href: string; children: ReactNode; ctx: EmailContext }) {
  const c = paletteFor(ctx.vibe);
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={{ margin: "8px 0 20px" }}>
      <tbody>
        <tr>
          <td style={{ backgroundColor: c.accent }}>
            <Button
              href={href}
              style={{ display: "inline-block", padding: "13px 24px", backgroundColor: c.accent, color: c.onAccent, fontFamily: FONT_STACK, fontSize: 16, fontWeight: 700, textDecoration: "none" }}
            >
              {children}
            </Button>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Label / value rows (courier, AWB, payment id, ...). */
export function Facts({ rows, ctx }: { rows: [string, ReactNode][]; ctx: EmailContext }) {
  const c = paletteFor(ctx.vibe);
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} bgcolor={c.surfaceAlt} style={{ backgroundColor: c.surfaceAlt, margin: "0 0 20px" }}>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td style={{ padding: "8px 14px", fontFamily: FONT_STACK, fontSize: 14, lineHeight: "20px", color: c.muted, width: "38%", verticalAlign: "top" }}>{label}</td>
            <td style={{ padding: "8px 14px", fontFamily: FONT_STACK, fontSize: 14, lineHeight: "20px", color: c.ink, fontWeight: 700, verticalAlign: "top", wordBreak: "break-word" }}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Link to the order page when a guest token travelled with the payload, else the public tracker. */
export function orderLink(ctx: EmailContext, ref: string, token?: string | null): { href: string; label: string } {
  if (token) return { href: `${ctx.siteUrl}/orders/${encodeURIComponent(ref)}?t=${encodeURIComponent(token)}`, label: "View your order" };
  return { href: `${ctx.siteUrl}/track`, label: "Track your order" };
}

export function OrderCta({ ctx, orderRef, token }: { ctx: EmailContext; orderRef: string; token?: string | null }) {
  const l = orderLink(ctx, orderRef, token);
  return (
    <>
      <Cta href={l.href} ctx={ctx}>
        {l.label}
      </Cta>
      {token ? null : (
        <P ctx={ctx} muted>
          Use your order reference {orderRef} and the email address on the order.
        </P>
      )}
    </>
  );
}

export function TextLink({ href, children, ctx }: { href: string; children: ReactNode; ctx: EmailContext }) {
  return (
    <Link href={href} style={{ color: paletteFor(ctx.vibe).link, textDecoration: "underline" }}>
      {children}
    </Link>
  );
}

const money = (paise: number) => formatINR(paise);

/** Items, amount breakdown (GST included in the total, never added) and ship-to block. */
export function OrderSummary({ order, ctx, showAddress = true }: { order: OrderView; ctx: EmailContext; showAddress?: boolean }) {
  const c = paletteFor(ctx.vibe);
  const td: CSSProperties = { fontFamily: FONT_STACK, fontSize: 14, lineHeight: "20px", color: c.ink, padding: "10px 0", borderBottom: `1px solid ${c.surfaceAlt}`, verticalAlign: "top" };
  const row = (label: string, value: string, opts: { strong?: boolean; color?: string } = {}) => (
    <tr key={label}>
      <td style={{ fontFamily: FONT_STACK, fontSize: opts.strong ? 16 : 14, lineHeight: "22px", padding: "3px 0", color: opts.strong ? c.ink : c.muted, fontWeight: opts.strong ? 800 : 400 }}>{label}</td>
      <td align="right" style={{ fontFamily: FONT_STACK, fontSize: opts.strong ? 16 : 14, lineHeight: "22px", padding: "3px 0", color: opts.color ?? c.ink, fontWeight: opts.strong ? 800 : 400, whiteSpace: "nowrap" }}>{value}</td>
    </tr>
  );
  return (
    <>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={{ margin: "4px 0 12px" }}>
        <tbody>
          {order.items.map((it, i) => (
            <tr key={i}>
              <td style={td}>
                <strong>{it.name}</strong>
                {it.variant ? <span style={{ color: c.muted }}> ({it.variant})</span> : null}
                <br />
                <span style={{ color: c.muted }}>
                  {it.qty} x {money(it.unitPaise)}
                </span>
              </td>
              <td align="right" style={{ ...td, whiteSpace: "nowrap", paddingLeft: 12 }}>
                {money(it.grossPaise)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={{ margin: "0 0 4px" }}>
        <tbody>
          {row("Subtotal", money(order.subtotalPaise))}
          {order.discountPaise > 0 ? row(order.couponCode ? `Discount (${order.couponCode})` : "Discount", `-${money(order.discountPaise)}`, { color: c.success }) : null}
          {row("Shipping", order.shippingPaise > 0 ? money(order.shippingPaise) : "Free")}
          {order.codFeePaise > 0 ? row("Cash on delivery fee", money(order.codFeePaise)) : null}
          {row(order.paymentMethod === "cod" ? "Total to pay on delivery" : "Total paid", money(order.totalPaise), { strong: true })}
        </tbody>
      </table>
      <p style={{ margin: "0 0 18px", fontFamily: FONT_STACK, fontSize: 12, lineHeight: "18px", color: c.muted }}>
        All prices include taxes.
        {order.taxIncludedPaise > 0 ? ` Includes GST of ${money(order.taxIncludedPaise)}.` : ""}
      </p>
      {showAddress ? (
        <p style={{ margin: "0 0 16px", fontFamily: FONT_STACK, fontSize: 14, lineHeight: "21px", color: c.ink }}>
          <strong>Delivering to</strong>
          <br />
          {order.shipTo.name}
          {order.shipTo.lines.map((l, i) => (
            <span key={i}>
              <br />
              {l}
            </span>
          ))}
        </p>
      ) : null}
    </>
  );
}
