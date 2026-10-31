import { formatINR } from "@/lib/money";

import { Layout } from "../layout";
import { Facts, OrderCta, OrderSummary, P, TextLink } from "../parts";
import type { TemplateProps } from "../payloads";
import type { EmailContext } from "../types";

/** Order lines + amounts, or a short fallback when the order row is gone (never blocks the e-mail). */
function Summary({ ctx, total }: { ctx: EmailContext; total?: number }) {
  if (ctx.order) return <OrderSummary order={ctx.order} ctx={ctx} />;
  return total !== undefined ? <P ctx={ctx}>Order total: {formatINR(total)} (all prices include taxes).</P> : null;
}

export function OrderConfirmed({ payload, ctx }: TemplateProps<"order_confirmed">) {
  const cod = payload.paymentMethod === "cod";
  return (
    <Layout ctx={ctx} preview={`Order ${payload.ref} is confirmed.`} heading="Thanks, your order is confirmed">
      <P ctx={ctx}>
        We have your order <strong>{payload.ref}</strong>
        {cod ? ". Please keep the amount ready for the delivery person." : " and your payment went through."} We will email you again when it ships.
      </P>
      {payload.late ? (
        <P ctx={ctx} muted>
          Your payment reached us after the checkout window closed, and everything was still in stock, so the order is confirmed.
        </P>
      ) : null}
      <Summary ctx={ctx} total={payload.totalPaise} />
      {ctx.invoiceAttached ? (
        <P ctx={ctx} muted>
          Your invoice is attached to this email.
        </P>
      ) : null}
      <OrderCta ctx={ctx} orderRef={payload.ref} token={payload.accessToken} />
    </Layout>
  );
}

export function CodPlaced({ payload, ctx }: TemplateProps<"cod_placed">) {
  return (
    <Layout ctx={ctx} preview={`Order ${payload.ref} is placed. Pay on delivery.`} heading="Your order is placed">
      <P ctx={ctx}>
        We have your order <strong>{payload.ref}</strong>. You will pay in cash when it is delivered, so please keep{" "}
        <strong>{formatINR(payload.totalPaise)}</strong> ready.
      </P>
      <Summary ctx={ctx} total={payload.totalPaise} />
      <OrderCta ctx={ctx} orderRef={payload.ref} token={payload.accessToken} />
    </Layout>
  );
}

export function PaymentFailed({ payload, ctx }: TemplateProps<"payment_failed">) {
  return (
    <Layout ctx={ctx} preview={`Payment for order ${payload.ref} was not completed.`} heading="Your payment did not go through">
      <P ctx={ctx}>
        The payment for order <strong>{payload.ref}</strong> was not completed, so the order is not confirmed yet. No money has been taken for it, and if
        anything was debited your bank will return it.
      </P>
      <P ctx={ctx}>If the items are still available you can try again from your order page while the reservation lasts.</P>
      <OrderCta ctx={ctx} orderRef={payload.ref} token={payload.accessToken} />
    </Layout>
  );
}

export function OrderShipped({ payload, ctx }: TemplateProps<"order_shipped">) {
  const rows: [string, string][] = [["Order", payload.ref]];
  if (payload.courier) rows.push(["Courier", payload.courier]);
  if (payload.awb) rows.push(["Tracking number (AWB)", payload.awb]);
  return (
    <Layout ctx={ctx} preview={`Order ${payload.ref} is on its way.`} heading="Your order is on its way">
      <P ctx={ctx}>
        Order <strong>{payload.ref}</strong> has been handed to the courier.
        {ctx.order?.paymentMethod === "cod" ? ` Please keep ${formatINR(ctx.order.totalPaise)} ready for delivery.` : ""}
      </P>
      <Facts rows={rows} ctx={ctx} />
      {payload.trackingUrl ? (
        <P ctx={ctx}>
          Follow it here: <TextLink href={payload.trackingUrl} ctx={ctx}>{payload.trackingUrl}</TextLink>
        </P>
      ) : null}
      {ctx.order ? <OrderSummary order={ctx.order} ctx={ctx} /> : null}
      <OrderCta ctx={ctx} orderRef={payload.ref} token={payload.accessToken} />
    </Layout>
  );
}

export function OrderDelivered({ payload, ctx }: TemplateProps<"order_delivered">) {
  return (
    <Layout ctx={ctx} preview={`Order ${payload.ref} was delivered.`} heading="Your order was delivered">
      <P ctx={ctx}>
        Order <strong>{payload.ref}</strong> has been delivered. We hope you like it.
      </P>
      <P ctx={ctx}>
        If something is damaged, wrong or missing, tell us from your order page as soon as you can and we will sort it out.
      </P>
      <OrderCta ctx={ctx} orderRef={payload.ref} token={payload.accessToken} />
    </Layout>
  );
}

export function OrderCancelled({ payload, ctx }: TemplateProps<"order_cancelled">) {
  return (
    <Layout ctx={ctx} preview={`Order ${payload.ref} was cancelled.`} heading="Your order was cancelled">
      <P ctx={ctx}>
        Order <strong>{payload.ref}</strong> has been cancelled. If you paid online, the refund is started automatically and you will get a separate email
        when it is on its way back to you.
      </P>
      {ctx.order ? <OrderSummary order={ctx.order} ctx={ctx} showAddress={false} /> : null}
      <P ctx={ctx} muted>
        Not expecting this? Reply to this email or write to {ctx.store.supportEmail}.
      </P>
    </Layout>
  );
}
