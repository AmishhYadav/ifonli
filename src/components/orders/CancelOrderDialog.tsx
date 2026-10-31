"use client";

import { useState } from "react";

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  Icon,
  Select,
  useToast,
} from "@/components/ui";
import { cancelOrderAction } from "@/features/orders/actions";
import { CANCEL_REASONS } from "@/features/orders/cancel-reasons";

export interface CancelOrderDialogProps {
  orderRef: string;
  /** Guest `?t=` token; omitted for a signed-in owner. */
  token?: string;
  paymentMethod: "razorpay" | "cod";
  /** Pre-formatted amount, e.g. "₹1,299". */
  totalLabel: string;
}

/**
 * "Cancel order" with a confirmation step (plan 7.8). Prepaid orders are refunded in full
 * automatically; the dialog says exactly that, in plain words, before anything happens.
 */
export function CancelOrderDialog({ orderRef, token, paymentMethod, totalLabel }: CancelOrderDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prepaid = paymentMethod === "razorpay";

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await cancelOrderAction({ ref: orderRef, token, reason: reason || undefined });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    if (result.alreadyCancelled) {
      toast({ title: "This order was already cancelled", tone: "info" });
    } else if (result.prepaid && result.refundPaise !== null && !result.refundDelayed) {
      toast({
        title: "Your order is cancelled",
        description: `We've started a full refund to your original payment method. Banks can take a few working days to show it.`,
        tone: "success",
        duration: 9000,
      });
    } else if (result.prepaid && result.refundDelayed) {
      toast({
        title: "Your order is cancelled",
        description:
          "We couldn't start the refund just now. Don't worry: we've been told and will sort it out, and you'll get an email.",
        tone: "info",
        duration: 12000,
      });
    } else {
      toast({ title: "Your order is cancelled", description: "You hadn't paid anything, so there's nothing to refund.", tone: "success" });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" iconStart="close" data-testid="cancel-order">
          Cancel order
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Cancel this order?"
        description={
          prepaid
            ? `We'll refund the full ${totalLabel} to your original payment method. Banks can take a few working days to show it.`
            : "You haven't paid anything yet, so there's nothing to refund."
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy} data-testid="cancel-keep">
                Keep my order
              </Button>
            </DialogClose>
            <Button loading={busy} onClick={() => void confirm()} data-testid="cancel-confirm">
              Yes, cancel order
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-base">
            This can&apos;t be undone. If you change your mind later, you&apos;ll need to place a new order.
          </p>
          <Field label="Why are you cancelling? (optional)" hint="This just helps us improve.">
            <Select value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}>
              <option value="">Prefer not to say</option>
              {CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          {error ? (
            <p role="alert" className="flex items-start gap-2 text-base font-semibold text-danger" data-testid="cancel-error">
              <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
