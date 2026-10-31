import { formatINR } from "@/lib/money";

import { Layout } from "../layout";
import { Facts, OrderCta, P } from "../parts";
import type { TemplateProps } from "../payloads";

export function RefundInitiated({ payload, ctx }: TemplateProps<"refund_initiated">) {
  return (
    <Layout ctx={ctx} preview={`A refund of ${formatINR(payload.amountPaise)} was started.`} heading="Your refund has started">
      <P ctx={ctx}>
        We have started a refund of <strong>{formatINR(payload.amountPaise)}</strong> for order <strong>{payload.ref}</strong>. It goes back to the
        payment method you used.
      </P>
      <Facts
        rows={[
          ["Order", payload.ref],
          ["Refund amount", formatINR(payload.amountPaise)],
        ]}
        ctx={ctx}
      />
      <P ctx={ctx} muted>
        Banks usually take 5 to 7 working days to show it. We will email you again once it is processed.
      </P>
      <OrderCta ctx={ctx} orderRef={payload.ref} />
    </Layout>
  );
}

export function RefundProcessed({ payload, ctx }: TemplateProps<"refund_processed">) {
  const cod = ctx.order?.paymentMethod === "cod";
  return (
    <Layout ctx={ctx} preview={`Your refund of ${formatINR(payload.amountPaise)} is processed.`} heading="Your refund is processed">
      <P ctx={ctx}>
        The refund of <strong>{formatINR(payload.amountPaise)}</strong> for order <strong>{payload.ref}</strong> has been processed.
        {cod ? " Our team has paid it out to you directly." : " It should show up in your account within a few working days, depending on your bank."}
      </P>
      <Facts
        rows={[
          ["Order", payload.ref],
          ["Refunded", formatINR(payload.amountPaise)],
        ]}
        ctx={ctx}
      />
      <P ctx={ctx} muted>
        Still nothing after 7 working days? Write to {ctx.store.supportEmail} with your order reference.
      </P>
    </Layout>
  );
}

/** A captured payment that could not become an order (items sold out while the customer was paying). */
export function LateCaptureRefunded({ payload, ctx }: TemplateProps<"payment_late_refund">) {
  return (
    <Layout ctx={ctx} preview="We are sorry: your order could not be completed and your payment is being refunded." heading="Sorry, we could not complete your order">
      <P ctx={ctx}>
        Your payment for order <strong>{payload.ref}</strong> reached us after some of the items had sold out, so we could not fulfil the order. We are
        sorry about that.
      </P>
      <P ctx={ctx}>
        We have started a full refund of <strong>{formatINR(payload.amountPaise)}</strong> to the payment method you used. Banks usually take 5 to 7
        working days to show it.
      </P>
      <P ctx={ctx} muted>
        If you have any questions, write to {ctx.store.supportEmail} and mention {payload.ref}.
      </P>
    </Layout>
  );
}
