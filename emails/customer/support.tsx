import { Layout } from "../layout";
import { Facts, P } from "../parts";
import type { TemplateProps } from "../payloads";

const STATUS_LABEL = {
  open: "Received",
  in_progress: "Being looked at",
  resolved: "Resolved",
  rejected: "Closed",
} as const;

const RESOLUTION_LABEL = {
  refund: "A refund",
  replacement: "A replacement",
  rejected: "We could not approve this request",
} as const;

export function SupportCaseUpdate({ payload, ctx }: TemplateProps<"support_case_update">) {
  const rows: [string, string][] = [
    ["Order", payload.ref],
    ["Status", STATUS_LABEL[payload.status]],
  ];
  if (payload.resolution) rows.push(["Outcome", RESOLUTION_LABEL[payload.resolution]]);
  return (
    <Layout ctx={ctx} preview={`Update on your request for order ${payload.ref}.`} heading="An update on your request">
      <P ctx={ctx}>There is news on the request you sent us about order {payload.ref}.</P>
      <Facts rows={rows} ctx={ctx} />
      {payload.note ? (
        <P ctx={ctx} style={{ whiteSpace: "pre-line" }}>
          {payload.note}
        </P>
      ) : null}
      <P ctx={ctx} muted>
        Just reply to this email if you want to add anything.
      </P>
    </Layout>
  );
}

export function ContactReply({ payload, ctx }: TemplateProps<"contact_reply">) {
  const name = payload.name.trim().split(/\s+/)[0] ?? "";
  return (
    <Layout ctx={ctx} preview="A reply to your message." heading="A reply from our team">
      {name ? <P ctx={ctx}>Hi {name},</P> : null}
      <P ctx={ctx} style={{ whiteSpace: "pre-line" }}>
        {payload.message}
      </P>
      {payload.original ? (
        <>
          <P ctx={ctx} muted>
            You wrote:
          </P>
          <P ctx={ctx} muted style={{ whiteSpace: "pre-line" }}>
            {payload.original}
          </P>
        </>
      ) : null}
      <P ctx={ctx} muted>
        Just reply to this email if you want to add anything. Our support hours are {ctx.store.supportHours}.
      </P>
    </Layout>
  );
}

export function ContactAck({ payload, ctx }: TemplateProps<"contact_ack">) {
  const name = payload.name.trim().split(/\s+/)[0] ?? "";
  return (
    <Layout ctx={ctx} preview="We got your message and will reply soon." heading="We got your message">
      <P ctx={ctx}>{name ? `Hi ${name}, thanks` : "Thanks"} for writing to us. A real person will read it and reply by email.</P>
      <P ctx={ctx} muted>
        Our support hours are {ctx.store.supportHours}. If it is urgent, call {ctx.store.supportPhone}.
      </P>
    </Layout>
  );
}
