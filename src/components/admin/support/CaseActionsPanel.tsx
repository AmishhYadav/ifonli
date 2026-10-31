"use client";

import { Ban, CircleCheck, Play } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { rejectCaseAction, resolveCaseAction, setCaseStatusAction } from "@/app/admin/(app)/support/actions";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/admin/ui";
import { formatINR } from "@/lib/money";
import type { SupportStatus } from "@/server/domain/support-state";

import { paiseToRupees, rupeesToPaiseStrict } from "./money-input";
import { CaseStatusBadge } from "./status";
import { useAct } from "./use-act";

export interface CaseActionsProps {
  caseId: string;
  shortId: string;
  orderRef: string;
  status: SupportStatus;
  paymentMethod: "razorpay" | "cod";
  /** Lines of the original order a replacement can pick from. */
  items: { id: string; name: string; sku: string; qty: number }[];
  refundablePaise: number;
  /** Replacement orders only make sense for placed orders. */
  canReplace: boolean;
  allow: { respond: boolean; resolve: boolean; refund: boolean };
}

export function CaseActionsPanel(p: CaseActionsProps) {
  const act = useAct();
  const [dialog, setDialog] = React.useState<null | "resolve" | "reject">(null);
  const active = p.status === "open" || p.status === "in_progress";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decision</CardTitle>
        <CardDescription>
          <span className="inline-flex items-center gap-2">
            <CaseStatusBadge status={p.status} />
            {active ? "Pick up the case, then resolve or reject it." : "This case is closed."}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {active && p.status === "open" && p.allow.respond ? (
          <Button
            variant="outline"
            disabled={act.pending}
            onClick={() =>
              act.run(
                () => setCaseStatusAction(p.caseId, { status: "in_progress" }),
                () => toast.success(`Case ${p.shortId} is in progress`),
              )
            }
          >
            <Play aria-hidden /> Start working on it
          </Button>
        ) : null}
        {active && p.allow.resolve ? (
          <>
            <Button onClick={() => setDialog("resolve")} disabled={act.pending}>
              <CircleCheck aria-hidden /> Resolve…
            </Button>
            <Button variant="danger-outline" onClick={() => setDialog("reject")} disabled={act.pending}>
              <Ban aria-hidden /> Reject…
            </Button>
          </>
        ) : null}
        {active && !p.allow.resolve ? (
          <p className="text-[13px] text-admin-ink-muted">
            Your role can reply and add notes. An admin resolves or rejects the case.
          </p>
        ) : null}
        {!active ? <p className="text-[13px] text-admin-ink-muted">Reply to the customer if they need something else.</p> : null}
      </CardContent>
      {dialog === "resolve" ? <ResolveDialog {...p} onClose={() => setDialog(null)} /> : null}
      {dialog === "reject" ? <RejectDialog {...p} onClose={() => setDialog(null)} /> : null}
    </Card>
  );
}

type DialogProps = CaseActionsProps & { onClose: () => void };

function ResolveDialog({ caseId, shortId, orderRef, paymentMethod, items, refundablePaise, canReplace, allow, onClose }: DialogProps) {
  const act = useAct();
  const refundOk = allow.refund && refundablePaise > 0;
  const [outcome, setOutcome] = React.useState<"refund" | "replacement">(refundOk ? "refund" : "replacement");
  const [amount, setAmount] = React.useState(paiseToRupees(refundablePaise));
  const [reference, setReference] = React.useState("");
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [message, setMessage] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const isCod = paymentMethod === "cod";

  const paise = rupeesToPaiseStrict(amount);
  const amountError =
    paise === null || paise <= 0
      ? "Enter an amount in rupees, like 499 or 499.50"
      : paise > refundablePaise
        ? `At most ${formatINR(refundablePaise)} can still be refunded`
        : undefined;
  const lines = items
    .map((i) => ({ orderItemId: i.id, qty: Math.min(i.qty, Math.max(0, Number.parseInt(qty[i.id] ?? "0", 10) || 0)) }))
    .filter((l) => l.qty > 0);

  const ready =
    outcome === "refund"
      ? !amountError && (!isCod || reference.trim().length > 0)
      : lines.length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setErrors({});
    const common = { message, note };
    const input =
      outcome === "refund"
        ? { resolution: "refund", amountPaise: paise, reference, ...common }
        : { resolution: "replacement", lines, ...common };
    act.run(
      () => resolveCaseAction(caseId, input),
      (res) => {
        if (res.refund?.providerError) {
          toast.warning(`Case resolved. The refund is saved but the provider did not accept it yet: ${res.refund.providerError}`);
        } else if (res.refund) {
          toast.success(`Case ${shortId} resolved. Refund of ${formatINR(res.refund.amountPaise)} ${isCod ? "recorded" : "started"}.`);
        } else if (res.replacement) {
          toast.success(`Case ${shortId} resolved. Replacement order ${res.replacement.ref} created.`);
        } else toast.success(`Case ${shortId} resolved`);
        onClose();
      },
      (m, fields) => setErrors(fields ?? { form: m }),
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !act.pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Resolve case {shortId}</DialogTitle>
            <DialogDescription>
              Order {orderRef}. The customer is e-mailed the outcome. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <Field label="Outcome" htmlFor="resolve-outcome" required>
            <Select
              id="resolve-outcome"
              value={outcome}
              onValueChange={(v) => setOutcome(v === "replacement" ? "replacement" : "refund")}
              options={[
                {
                  value: "refund",
                  label: refundOk ? "Refund (full or partial)" : "Refund (not available)",
                  disabled: !refundOk,
                },
                {
                  value: "replacement",
                  label: canReplace ? "Replacement (no-charge order)" : "Replacement (not available)",
                  disabled: !canReplace,
                },
              ]}
            />
          </Field>
          {!allow.refund ? (
            <p className="text-xs text-admin-ink-muted">Refunds need the refund permission, which your role does not have.</p>
          ) : refundablePaise <= 0 ? (
            <p className="text-xs text-admin-ink-muted">Nothing is left to refund on this order.</p>
          ) : null}

          {outcome === "refund" ? (
            <>
              <Field
                label="Refund amount (₹)"
                htmlFor="resolve-amount"
                required
                error={amount ? amountError : undefined}
                hint={`Up to ${formatINR(refundablePaise)} can still be refunded.`}
              >
                <div className="flex gap-2">
                  <Input
                    id="resolve-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="tabular"
                    aria-invalid={Boolean(amount && amountError)}
                  />
                  <Button variant="outline" onClick={() => setAmount(paiseToRupees(refundablePaise))}>
                    Full
                  </Button>
                </div>
              </Field>
              {isCod ? (
                <Field
                  label="UPI / bank reference"
                  htmlFor="resolve-reference"
                  required
                  error={errors.reference}
                  hint="Cash on delivery: pay the customer yourself, then record the reference."
                >
                  <Input
                    id="resolve-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    maxLength={120}
                    className="font-mono"
                  />
                </Field>
              ) : null}
            </>
          ) : (
            <fieldset className="grid gap-2 rounded-md border border-admin-border p-3">
              <legend className="px-1 text-xs font-medium text-admin-ink-muted">Units to send again</legend>
              {items.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <label htmlFor={`rep-${i.id}`} className="min-w-0">
                    <span className="block truncate">{i.name}</span>
                    <span className="block font-mono text-xs text-admin-ink-muted">{i.sku}</span>
                  </label>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-admin-ink-muted">
                    <Input
                      id={`rep-${i.id}`}
                      inputMode="numeric"
                      className="tabular h-8 w-16 text-right"
                      value={qty[i.id] ?? ""}
                      placeholder="0"
                      onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })}
                    />
                    of {i.qty}
                  </span>
                </div>
              ))}
              <p className="text-xs text-admin-ink-muted">
                Creates a no-charge order that takes the stock off the shelf and goes to the packing queue.
              </p>
              {errors.lines ? (
                <p role="alert" className="text-xs text-admin-danger">
                  {errors.lines}
                </p>
              ) : null}
            </fieldset>
          )}

          <Field
            label="Message to the customer"
            htmlFor="resolve-message"
            hint="Optional. A standard, friendly message is sent if you leave this blank."
          >
            <Textarea id="resolve-message" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <Field label="Internal note" htmlFor="resolve-note" hint="Optional. Kept in the case notes; never e-mailed.">
            <Textarea id="resolve-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {errors.form ? (
            <p role="alert" className="text-xs text-admin-danger">
              {errors.form}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={act.pending}>
              Cancel
            </Button>
            <Button type="submit" loading={act.pending} disabled={!ready}>
              {outcome === "refund" && paise && !amountError ? `Refund ${formatINR(paise)} and resolve` : "Resolve case"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ caseId, shortId, orderRef, onClose }: DialogProps) {
  const act = useAct();
  const [message, setMessage] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    act.run(
      () => rejectCaseAction(caseId, { message, note }),
      () => {
        toast.success(`Case ${shortId} rejected. The customer was e-mailed.`);
        onClose();
      },
      (m, fields) => setError(fields?.message ?? m),
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !act.pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Reject case {shortId}</DialogTitle>
            <DialogDescription>
              Order {orderRef}. The customer receives your message by e-mail, so say why and what they can still do.
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Message to the customer"
            htmlFor="reject-message"
            required
            error={error}
            hint="Be kind and specific. For example: we couldn't see damage in the photos; reply with a clearer one and we'll look again."
          >
            <Textarea
              id="reject-message"
              rows={4}
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Internal note" htmlFor="reject-note" hint="Optional. Kept in the case notes; never e-mailed.">
            <Textarea id="reject-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={act.pending}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={act.pending} disabled={!message.trim()}>
              Reject case
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
