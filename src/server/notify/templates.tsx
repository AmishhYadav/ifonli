import { render } from "react-email";
import type { ReactElement } from "react";

import { formatINR } from "@/lib/money";

import { LowStockDigest, NewContact, NewOrder, NewSupportCase, OutboxFailure, PaymentAnomaly, ANOMALY_LABEL } from "../../../emails/admin/alerts";
import { CodPlaced, OrderCancelled, OrderConfirmed, OrderDelivered, OrderShipped, PaymentFailed } from "../../../emails/customer/order";
import { LoginOtp } from "../../../emails/customer/otp";
import { LateCaptureRefunded, RefundInitiated, RefundProcessed } from "../../../emails/customer/refund";
import { ContactAck, SupportCaseUpdate } from "../../../emails/customer/support";
import { payloadSchemas, type PayloadOf, type TemplateName, type TemplateProps } from "../../../emails/payloads";
import type { EmailContext } from "../../../emails/types";

/**
 * Template registry (plan 7.10): name -> payload schema, subject, component, audience. The payload is
 * validated on every render, so a bad payload fails loudly instead of sending a half-empty e-mail.
 * Components live in `emails/` (React Email, inline styles); this file is the only server-side seam.
 */
export interface TemplateDef<T extends TemplateName> {
  /** Customer e-mails carry the order (items, amounts, vibe palette) when the row has one; admin e-mails are neutral. */
  audience: "customer" | "admin";
  /** Attach the invoice PDF when one can be produced. */
  attachInvoice: boolean;
  subject(payload: PayloadOf<T>, ctx: EmailContext): string;
  Component(props: TemplateProps<T>): ReactElement;
}

const def = <T extends TemplateName>(d: TemplateDef<T>): TemplateDef<T> => d;

export const TEMPLATES: { [T in TemplateName]: TemplateDef<T> } = {
  order_confirmed: def({
    audience: "customer",
    attachInvoice: true,
    subject: (p) => `Order ${p.ref} is confirmed`,
    Component: OrderConfirmed,
  }),
  cod_placed: def({
    audience: "customer",
    attachInvoice: true,
    subject: (p) => `Order ${p.ref} is placed (pay on delivery)`,
    Component: CodPlaced,
  }),
  payment_failed: def({
    audience: "customer",
    attachInvoice: false,
    subject: (p) => `Payment not completed for order ${p.ref}`,
    Component: PaymentFailed,
  }),
  order_shipped: def({
    audience: "customer",
    attachInvoice: false,
    subject: (p) => `Order ${p.ref} is on its way`,
    Component: OrderShipped,
  }),
  order_delivered: def({
    audience: "customer",
    attachInvoice: false,
    subject: (p) => `Order ${p.ref} was delivered`,
    Component: OrderDelivered,
  }),
  order_cancelled: def({
    audience: "customer",
    attachInvoice: false,
    subject: (p) => `Order ${p.ref} was cancelled`,
    Component: OrderCancelled,
  }),
  refund_initiated: def({
    audience: "customer",
    attachInvoice: false,
    subject: (p) => `Refund started for order ${p.ref}`,
    Component: RefundInitiated,
  }),
  refund_processed: def({
    audience: "customer",
    attachInvoice: false,
    subject: (p) => `Refund processed for order ${p.ref}`,
    Component: RefundProcessed,
  }),
  payment_late_refund: def({
    audience: "customer",
    attachInvoice: false,
    subject: (p) => `Sorry, we could not complete order ${p.ref}`,
    Component: LateCaptureRefunded,
  }),
  support_case_update: def({
    audience: "customer",
    attachInvoice: false,
    subject: (p) => `Update on your request for order ${p.ref}`,
    Component: SupportCaseUpdate,
  }),
  contact_ack: def({
    audience: "customer",
    attachInvoice: false,
    subject: () => "We got your message",
    Component: ContactAck,
  }),
  login_otp: def({
    audience: "customer",
    attachInvoice: false,
    subject: (p) => `${p.otp} is your sign-in code`,
    Component: LoginOtp,
  }),
  new_order: def({
    audience: "admin",
    attachInvoice: false,
    subject: (p) => `New order ${p.ref} (${formatINR(p.totalPaise)})`,
    Component: NewOrder,
  }),
  low_stock_digest: def({
    audience: "admin",
    attachInvoice: false,
    subject: (p) => `Low stock: ${p.total} variant${p.total === 1 ? "" : "s"} need attention`,
    Component: LowStockDigest,
  }),
  payment_anomaly: def({
    audience: "admin",
    attachInvoice: false,
    subject: (p) => `Payment issue on ${p.ref}: ${ANOMALY_LABEL[p.kind] ?? p.kind}`,
    Component: PaymentAnomaly,
  }),
  new_support_case: def({
    audience: "admin",
    attachInvoice: false,
    subject: (p) => `New support case for order ${p.ref}`,
    Component: NewSupportCase,
  }),
  new_contact: def({
    audience: "admin",
    attachInvoice: false,
    subject: (p) => `New contact message from ${p.name}`,
    Component: NewContact,
  }),
  outbox_failure: def({
    audience: "admin",
    attachInvoice: false,
    subject: (p) => `Email could not be sent: ${p.template}`,
    Component: OutboxFailure,
  }),
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[];

/** Our layouts are tables: put each row on its own line and separate cells, and keep headings in sentence case. */
const PLAIN_TEXT: { selectors: { selector: string; format?: string; options?: Record<string, unknown> }[] } = {
  selectors: [
    { selector: "h1", options: { uppercase: false } },
    { selector: "th", format: "inlineSurround", options: { suffix: "  " } },
    { selector: "tr", format: "block", options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
    { selector: "td", format: "inlineSurround", options: { suffix: "  " } },
  ],
};

/** Drop the trailing spaces cell separators leave behind and runs of blank lines. */
const tidyText = (t: string) => `${t.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim()}\n`;

export class UnknownTemplateError extends Error {
  constructor(name: string) {
    super(`Unknown notification template "${name}"`);
    this.name = "UnknownTemplateError";
  }
}

export function isTemplateName(name: string): name is TemplateName {
  return Object.hasOwn(TEMPLATES, name);
}

/** Header-safe single line: no CR/LF (header injection), collapsed spaces, bounded. */
export function oneLine(s: string, max = 200): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Validates `rawPayload` against the template's schema (throws a ZodError), then renders both bodies. */
export async function renderTemplate(name: string, rawPayload: unknown, ctx: EmailContext): Promise<RenderedEmail> {
  if (!isTemplateName(name)) throw new UnknownTemplateError(name);
  // One generic implementation behind the typed map: cast once, here.
  const d = TEMPLATES[name] as unknown as TemplateDef<TemplateName>;
  const payload = payloadSchemas[name].parse(rawPayload) as PayloadOf<TemplateName>;
  const element = <d.Component payload={payload} ctx={ctx} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true, htmlToTextOptions: PLAIN_TEXT })]);
  // React separates adjacent text nodes with empty comments; drop them (conditional comments stay).
  return { subject: oneLine(d.subject(payload, ctx)), html: html.replace(/<!-- -->/g, ""), text: tidyText(text) };
}
