import { Lock, Mail } from "lucide-react";

import { formatDateTime, statusWords } from "@/components/admin/orders/status";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/ui";
import type { SupportTimelineEntry } from "@/server/services/admin/support";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

interface Rendered {
  title: string;
  body: string | null;
  /** Reached the customer by e-mail. */
  email: boolean;
}

function render(e: SupportTimelineEntry): Rendered {
  const d = e.detail;
  const from = str(d.from);
  const to = str(d.to);
  switch (e.action) {
    case "support_case.assign":
    case "contact_message.assign":
      return {
        title: to ? `Assigned to ${to}` : "Unassigned",
        body: from ? `Was assigned to ${from}.` : null,
        email: false,
      };
    case "support_case.status":
    case "contact_message.status":
      return {
        title: `Status: ${from ? `${statusWords(from)} → ` : ""}${to ? statusWords(to) : ""}`,
        body: null,
        email: false,
      };
    case "support_case.note":
    case "contact_message.note":
      return { title: "Internal note", body: str(d.note), email: false };
    case "support_case.respond":
      return {
        title: str(d.to) ? `Replied to ${str(d.to)}` : "Replied to the customer",
        body: str(d.message),
        email: true,
      };
    case "contact_message.reply":
      return {
        title: str(d.to) ? `Replied to ${str(d.to)}` : "Replied by e-mail",
        body: str(d.message),
        email: true,
      };
    case "support_case.resolve": {
      const res = str(d.resolution);
      const extra =
        res === "refund"
          ? `Refund of ${typeof d.amountPaise === "number" ? `₹${(d.amountPaise / 100).toFixed(2)}` : "the order"}${str(d.refundStatus) ? ` (${str(d.refundStatus)})` : ""}.`
          : res === "replacement"
            ? `Replacement order ${str(d.replacementRef) ?? ""} created.`
            : null;
      return { title: `Resolved${res ? ` with a ${res}` : ""}`, body: extra, email: true };
    }
    case "support_case.reject":
      return { title: "Rejected", body: "The customer was told by e-mail.", email: true };
    default:
      return { title: statusWords(e.action.replace(/\./g, " ")), body: null, email: false };
  }
}

/** The history of one message or case, oldest at the bottom. Built from the audit log. */
export function SupportTimeline({ entries }: { entries: SupportTimelineEntry[] }) {
  const items = [...entries].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>Newest first. Everything staff did here is recorded.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-[13px] text-admin-ink-muted">Nothing has happened yet.</p>
        ) : (
          <ol className="grid gap-0">
            {items.map((e) => {
              const r = render(e);
              return (
                <li key={e.id} className="grid grid-cols-[1.25rem_1fr] gap-3 pb-4 last:pb-0">
                  <span
                    aria-hidden
                    className={`mt-1 size-2.5 justify-self-center rounded-full ${r.email ? "bg-admin-primary" : "bg-admin-border-strong"}`}
                  />
                  <div className="min-w-0 text-[13px]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-admin-ink">{r.title}</span>
                      {r.email ? (
                        <Badge tone="primary">
                          <Mail aria-hidden /> Customer e-mailed
                        </Badge>
                      ) : e.action.endsWith(".note") ? (
                        <Badge tone="neutral">
                          <Lock aria-hidden /> Internal
                        </Badge>
                      ) : null}
                    </div>
                    {r.body ? (
                      <p className="mt-0.5 whitespace-pre-wrap text-admin-ink-muted">{r.body}</p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-admin-ink-muted">
                      {formatDateTime(e.createdAt)}
                      {e.actorName ? ` · ${e.actorName}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
