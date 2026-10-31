"use client";

import { Ban, Mail, PackageCheck, PackageX, Truck, Undo2, Wallet, HandCoins, CheckCircle2, Navigation } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  addShipmentAction,
  cancelOrderAction,
  markCodCollectedAction,
  refundOrderAction,
  resendNotificationAction,
  updateFulfilmentAction,
} from "@/app/admin/(app)/orders/actions";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
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
import type { FulfillmentStatus } from "@/server/domain/order-state";
import { COURIER_PRESETS } from "@/server/services/admin/couriers";

export interface ActionsPanelProps {
  orderId: string;
  orderRef: string;
  paymentMethod: "razorpay" | "cod";
  status: string;
  fulfilment: FulfillmentStatus[];
  canAddShipment: boolean;
  canMarkCodCollected: boolean;
  canCancel: boolean;
  canRefund: boolean;
  resend: { value: string; label: string }[];
  /** Permission flags for the signed-in role (the server re-checks every action). */
  allow: {
    fulfil: boolean;
    ship: boolean;
    cod: boolean;
    cancel: boolean;
    refund: boolean;
    resend: boolean;
    /** `inventory:adjust`: may put returned units back on the shelf. */
    restock: boolean;
  };
  totalPaise: number;
  refundablePaise: number;
  /** Lines with units that can still go back on the shelf. */
  items: { variantId: string; name: string; sku: string; qty: number; restockable: number }[];
  hasShipment: boolean;
}

const STEP_LABEL: Record<string, string> = {
  packed: "Mark packed",
  unfulfilled: "Undo packed",
  out_for_delivery: "Out for delivery",
  delivered: "Mark delivered",
  rto: "Mark RTO",
  returned: "Mark returned",
};
const STEP_ICON: Record<string, React.ReactNode> = {
  packed: <PackageCheck aria-hidden />,
  unfulfilled: <Undo2 aria-hidden />,
  out_for_delivery: <Navigation aria-hidden />,
  delivered: <CheckCircle2 aria-hidden />,
  rto: <PackageX aria-hidden />,
  returned: <PackageX aria-hidden />,
};
const STEP_CONFIRM: Record<string, string> = {
  unfulfilled: "The order goes back to \"unfulfilled\" (use this to undo a mis-click before dispatch).",
  delivered: "The customer gets a \"delivered\" e-mail and the order is completed.",
  rto: "The courier is returning the parcel. A cash-on-delivery order stops expecting cash.",
};

/** "1299" / "1,299.50" -> paise, or null if it is not a valid rupee amount. */
function rupeesToPaiseStrict(text: string): number | null {
  const t = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
const paiseToRupees = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));

function useAct() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return {
    pending,
    run<T>(
      fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> }>,
      onOk: (data: T) => void,
      onError?: (message: string, fields?: Record<string, string>) => void,
    ) {
      start(async () => {
        const res = await fn();
        if (res.ok) {
          onOk(res.data);
          router.refresh();
        } else if (onError) onError(res.error, res.fieldErrors);
        else toast.error(res.error);
      });
    },
  };
}

export function OrderActionsPanel(p: ActionsPanelProps) {
  const act = useAct();
  const [dialog, setDialog] = React.useState<null | "ship" | "cancel" | "refund" | "resend" | "cod" | "returned">(null);
  const [confirmStep, setConfirmStep] = React.useState<string | null>(null);

  const steps = p.allow.fulfil ? p.fulfilment : [];
  const anything =
    steps.length > 0 ||
    (p.allow.ship && p.canAddShipment) ||
    (p.allow.cod && p.canMarkCodCollected) ||
    (p.allow.refund && p.canRefund) ||
    (p.allow.cancel && p.canCancel) ||
    (p.allow.resend && p.resend.length > 0);

  function step(to: string) {
    act.run(
      () => updateFulfilmentAction(p.orderId, { to }),
      () => toast.success(`${p.orderRef}: ${STEP_LABEL[to]?.toLowerCase() ?? to}`),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
        <CardDescription>Only the steps this order can take right now.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!anything ? <p className="text-[13px] text-admin-ink-muted">Nothing to do on this order.</p> : null}

        {p.allow.ship && p.canAddShipment ? (
          <Button onClick={() => setDialog("ship")} disabled={act.pending}>
            <Truck aria-hidden /> {p.hasShipment ? "Add another shipment" : "Add shipment"}
          </Button>
        ) : null}
        {steps.map((to) => (
          <Button
            key={to}
            variant={to === "packed" || to === "delivered" ? "outline" : "ghost"}
            className="justify-start"
            disabled={act.pending}
            onClick={() => {
              if (to === "returned") setDialog("returned");
              else if (STEP_CONFIRM[to]) setConfirmStep(to);
              else step(to);
            }}
          >
            {STEP_ICON[to]} {STEP_LABEL[to] ?? to}
          </Button>
        ))}
        {p.allow.cod && p.canMarkCodCollected ? (
          <Button variant="outline" onClick={() => setDialog("cod")} disabled={act.pending}>
            <HandCoins aria-hidden /> Mark COD collected
          </Button>
        ) : null}
        {p.allow.refund && p.canRefund ? (
          <Button variant="outline" onClick={() => setDialog("refund")} disabled={act.pending}>
            <Wallet aria-hidden /> Refund…
          </Button>
        ) : null}
        {p.allow.resend && p.resend.length > 0 ? (
          <Button variant="ghost" className="justify-start" onClick={() => setDialog("resend")} disabled={act.pending}>
            <Mail aria-hidden /> Resend e-mail…
          </Button>
        ) : null}
        {p.allow.cancel && p.canCancel ? (
          <Button variant="danger-outline" onClick={() => setDialog("cancel")} disabled={act.pending}>
            <Ban aria-hidden /> Cancel order…
          </Button>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={confirmStep !== null}
        onOpenChange={(o) => !o && setConfirmStep(null)}
        title={confirmStep ? `${STEP_LABEL[confirmStep]}?` : ""}
        description={confirmStep ? STEP_CONFIRM[confirmStep] : undefined}
        confirmLabel={confirmStep ? STEP_LABEL[confirmStep] : "Confirm"}
        onConfirm={() => {
          const to = confirmStep!;
          step(to);
        }}
      />
      <ConfirmDialog
        open={dialog === "cod"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Mark cash as collected?"
        description={`Records that ${formatINR(p.totalPaise)} was collected on delivery for ${p.orderRef}.`}
        confirmLabel="Mark collected"
        onConfirm={() =>
          act.run(
            () => markCodCollectedAction(p.orderId),
            () => toast.success("Cash marked as collected"),
          )
        }
      />
      {dialog === "ship" ? <ShipmentDialog {...p} onClose={() => setDialog(null)} /> : null}
      {dialog === "cancel" ? <CancelDialog {...p} onClose={() => setDialog(null)} /> : null}
      {dialog === "refund" ? <RefundDialog {...p} onClose={() => setDialog(null)} /> : null}
      {dialog === "resend" ? <ResendDialog {...p} onClose={() => setDialog(null)} /> : null}
      {dialog === "returned" ? <ReturnedDialog {...p} onClose={() => setDialog(null)} /> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------ */

type DialogProps = ActionsPanelProps & { onClose: () => void };

function ShipmentDialog({ orderId, orderRef, onClose }: DialogProps) {
  const act = useAct();
  const [preset, setPreset] = React.useState<string>(COURIER_PRESETS[0]!.name);
  const [other, setOther] = React.useState("");
  const [awb, setAwb] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const courier = preset === "__other" ? other.trim() : preset;
  const template = COURIER_PRESETS.find((c) => c.name === preset)?.trackingTemplate;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    act.run(
      () => addShipmentAction(orderId, { courier, awb, trackingUrl: url }),
      () => {
        toast.success(`${orderRef}: shipment added, customer e-mail queued`);
        onClose();
      },
      (message, fields) => setErrors(fields ?? { form: message }),
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !act.pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add shipment</DialogTitle>
            <DialogDescription>
              Marks {orderRef} as shipped and e-mails the customer the courier and tracking link.
            </DialogDescription>
          </DialogHeader>
          <Field label="Courier" htmlFor="ship-courier" required error={errors.courier}>
            <Select
              id="ship-courier"
              value={preset}
              onValueChange={setPreset}
              options={[
                ...COURIER_PRESETS.map((c) => ({ value: c.name, label: c.name })),
                { value: "__other", label: "Other…" },
              ]}
            />
          </Field>
          {preset === "__other" ? (
            <Field label="Courier name" htmlFor="ship-other" required>
              <Input id="ship-other" value={other} onChange={(e) => setOther(e.target.value)} maxLength={60} autoFocus />
            </Field>
          ) : null}
          <Field label="AWB / tracking number" htmlFor="ship-awb" error={errors.awb}>
            <Input id="ship-awb" value={awb} onChange={(e) => setAwb(e.target.value)} maxLength={64} className="font-mono" />
          </Field>
          <Field
            label="Tracking link"
            htmlFor="ship-url"
            error={errors.trackingUrl}
            hint={
              template
                ? "Optional. Left blank, the courier's standard link is built from the AWB."
                : "Optional. Paste the courier's tracking page for this parcel."
            }
          >
            <Input id="ship-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
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
            <Button type="submit" loading={act.pending} disabled={!courier}>
              Mark shipped
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ orderId, orderRef, paymentMethod, status, refundablePaise, onClose }: DialogProps) {
  const act = useAct();
  const [reason, setReason] = React.useState("");
  const [restock, setRestock] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>();
  const pendingPayment = status === "pending_payment";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    act.run(
      () => cancelOrderAction(orderId, { reason, restock }),
      (res) => {
        if (res.refundError) toast.warning(`Order cancelled. ${res.refundError}`);
        else if (res.refund) toast.success(`${orderRef} cancelled. Refund of ${formatINR(res.refund.amountPaise)} started.`);
        else toast.success(`${orderRef} cancelled`);
        onClose();
      },
      (message, fields) => setError(fields?.reason ?? message),
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !act.pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Cancel {orderRef}?</DialogTitle>
            <DialogDescription>
              {pendingPayment
                ? "Payment has not been received. The stock reservation and any coupon are released."
                : paymentMethod === "razorpay"
                  ? `The full ${formatINR(refundablePaise)} still refundable is returned to the customer through the payment provider.`
                  : "Cash on delivery: nothing was collected, so no refund is needed."}{" "}
              The customer is told by e-mail. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="cancel-reason" required error={error} hint="Internal. Not shown to the customer.">
            <Textarea
              id="cancel-reason"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </Field>
          {!pendingPayment ? (
            <Field label="Put the items back in stock" htmlFor="cancel-restock" inline>
              <Checkbox id="cancel-restock" checked={restock} onCheckedChange={(v) => setRestock(v === true)} />
            </Field>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={act.pending}>
              Keep order
            </Button>
            <Button type="submit" variant="danger" loading={act.pending} disabled={reason.trim().length < 3}>
              Cancel order
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({ orderId, orderRef, paymentMethod, refundablePaise, items, onClose }: DialogProps) {
  const act = useAct();
  const [amount, setAmount] = React.useState(paiseToRupees(refundablePaise));
  const [reason, setReason] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [restock, setRestock] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const isCod = paymentMethod === "cod";
  const paise = rupeesToPaiseStrict(amount);
  const amountError =
    paise === null || paise <= 0
      ? "Enter an amount in rupees, like 499 or 499.50"
      : paise > refundablePaise
        ? `At most ${formatINR(refundablePaise)} can still be refunded`
        : undefined;

  const restockLines = items
    .map((i) => ({ variantId: i.variantId, qty: Math.min(i.restockable, Math.max(0, Number.parseInt(restock[i.variantId] ?? "0", 10) || 0)) }))
    .filter((l) => l.qty > 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (amountError || paise === null) return;
    setErrors({});
    act.run(
      () => refundOrderAction(orderId, { amountPaise: paise, reason, reference, restock: restockLines }),
      (res) => {
        if (res.providerError) toast.warning(`Refund saved but the provider did not accept it yet: ${res.providerError}`);
        else toast.success(isCod ? "Manual refund recorded" : `Refund of ${formatINR(paise)} started`);
        onClose();
      },
      (message, fields) => setErrors(fields ?? { form: message }),
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !act.pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Refund {orderRef}</DialogTitle>
            <DialogDescription>
              {isCod
                ? "Cash on delivery: pay the customer yourself (UPI or bank transfer), then record it here with the reference."
                : "Refunded to the customer's original payment method through the payment provider."}{" "}
              Up to {formatINR(refundablePaise)} can still be refunded.
            </DialogDescription>
          </DialogHeader>
          <Field label="Amount (₹)" htmlFor="refund-amount" required error={amount ? amountError : undefined}>
            <div className="flex gap-2">
              <Input
                id="refund-amount"
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
          <Field label="Reason" htmlFor="refund-reason" required error={errors.reason}>
            <Textarea id="refund-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {isCod ? (
            <Field label="UPI / bank reference" htmlFor="refund-ref" required error={errors.reference}>
              <Input id="refund-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className="font-mono" />
            </Field>
          ) : null}
          {items.some((i) => i.restockable > 0) ? (
            <fieldset className="grid gap-2 rounded-md border border-admin-border p-3">
              <legend className="px-1 text-xs font-medium text-admin-ink-muted">Put back in stock (units)</legend>
              {items
                .filter((i) => i.restockable > 0)
                .map((i) => (
                  <div key={i.variantId} className="flex items-center justify-between gap-3 text-[13px]">
                    <label htmlFor={`rs-${i.variantId}`} className="min-w-0">
                      <span className="block truncate">{i.name}</span>
                      <span className="block font-mono text-xs text-admin-ink-muted">{i.sku}</span>
                    </label>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-admin-ink-muted">
                      <Input
                        id={`rs-${i.variantId}`}
                        inputMode="numeric"
                        className="tabular h-8 w-16 text-right"
                        value={restock[i.variantId] ?? ""}
                        placeholder="0"
                        onChange={(e) => setRestock({ ...restock, [i.variantId]: e.target.value })}
                      />
                      of {i.restockable}
                    </span>
                  </div>
                ))}
            </fieldset>
          ) : null}
          {errors.form ? (
            <p role="alert" className="text-xs text-admin-danger">
              {errors.form}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={act.pending}>
              Close
            </Button>
            <Button
              type="submit"
              loading={act.pending}
              disabled={Boolean(amountError) || reason.trim().length < 3 || (isCod && !reference.trim())}
            >
              {paise && !amountError ? `Refund ${formatINR(paise)}` : "Refund"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResendDialog({ orderId, orderRef, resend, onClose }: DialogProps) {
  const act = useAct();
  const [template, setTemplate] = React.useState(resend[0]?.value ?? "");
  return (
    <Dialog open onOpenChange={(o) => !o && !act.pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resend e-mail</DialogTitle>
          <DialogDescription>Queues the e-mail again for {orderRef}. It is sent with the next outbox run.</DialogDescription>
        </DialogHeader>
        <Field label="E-mail" htmlFor="resend-template">
          <Select id="resend-template" value={template} onValueChange={setTemplate} options={resend} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={act.pending}>
            Cancel
          </Button>
          <Button
            loading={act.pending}
            onClick={() =>
              act.run(
                () => resendNotificationAction(orderId, { template }),
                () => {
                  toast.success("E-mail queued");
                  onClose();
                },
              )
            }
          >
            Queue e-mail
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnedDialog({ orderId, orderRef, items, allow, onClose }: DialogProps) {
  const act = useAct();
  const [restock, setRestock] = React.useState(allow.restock);
  const units = items.reduce((s, i) => s + i.restockable, 0);
  return (
    <Dialog open onOpenChange={(o) => !o && !act.pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {orderRef} as returned?</DialogTitle>
          <DialogDescription>
            The parcel is back with you. A prepaid order still needs a refund from the Refund action.
          </DialogDescription>
        </DialogHeader>
        {units > 0 && allow.restock ? (
          <Field label={`Put ${units} unit(s) back in stock`} htmlFor="returned-restock" inline>
            <Checkbox id="returned-restock" checked={restock} onCheckedChange={(v) => setRestock(v === true)} />
          </Field>
        ) : units > 0 ? (
          <p className="text-xs text-admin-ink-muted">
            The {units} unit(s) won&apos;t go back in stock automatically. Ask an admin to restock them.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={act.pending}>
            Cancel
          </Button>
          <Button
            loading={act.pending}
            onClick={() =>
              act.run(
                () => updateFulfilmentAction(orderId, { to: "returned", restock: allow.restock && restock }),
                () => {
                  toast.success(`${orderRef} marked returned`);
                  onClose();
                },
              )
            }
          >
            Mark returned
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
