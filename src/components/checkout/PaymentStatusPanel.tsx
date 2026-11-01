"use client";

import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";

import type { PaymentPhase } from "./usePayment";

export interface PaymentStatusPanelProps {
  phase: PaymentPhase;
  onRetry: () => void;
  /** Where "View your order" goes while a payment is being confirmed. */
  orderUrl: string | null;
  email?: string;
  className?: string;
}

/** Reasons come from the payment provider and may lack a full stop. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

const box = "flex flex-col gap-3 rounded-card border-token p-4";

/**
 * What the customer sees around the payment popup: progress, "Payment not completed - Retry", "We're
 * confirming your payment", an expired window, or a verification error. Always in a live region.
 */
export function PaymentStatusPanel({
  phase,
  onRetry,
  orderUrl,
  email,
  className,
}: PaymentStatusPanelProps) {
  function render() {
    switch (phase.kind) {
      case "idle":
        return null;
      case "opening":
      case "open":
        return (
          <p className="flex items-center gap-2 text-base font-semibold">
            <Spinner />
            {phase.kind === "opening"
              ? "Opening secure payment..."
              : "Complete your payment in the payment window."}
          </p>
        );
      case "verifying":
        return (
          <p className="flex items-center gap-2 text-base font-semibold">
            <Spinner />
            Confirming your payment. Please don&apos;t close this page.
          </p>
        );
      case "incomplete":
        return (
          <div className={`${box} bg-surface`}>
            <p className="flex items-start gap-2 text-base font-bold text-warning">
              <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
              Payment not completed
            </p>
            <p className="text-base">
              {sentence(phase.reason ?? "Your payment wasn't completed")} Your items are held for a
              short time so you can try again.
            </p>
            <div>
              <Button onClick={onRetry} iconStart="refresh" data-testid="payment-retry">
                Retry payment
              </Button>
            </div>
          </div>
        );
      case "confirming":
        return (
          <div className={`${box} bg-surface`}>
            <p className="flex items-start gap-2 text-base font-bold">
              <Icon name="info" className="mt-0.5 size-5 flex-none" />
              We&apos;re confirming your payment
            </p>
            <p className="text-base">
              This is taking longer than usual. Please don&apos;t pay again. As soon as the bank
              confirms it we&apos;ll update your order{email ? ` and email ${email}` : ""}.
            </p>
            <div>
              <Button asChild variant="secondary">
                <Link href={orderUrl ?? "/track"}>View your order</Link>
              </Button>
            </div>
          </div>
        );
      case "expired":
        return (
          <div className={`${box} bg-surface`}>
            <p className="flex items-start gap-2 text-base font-bold text-warning">
              <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
              This payment window has expired
            </p>
            <p className="text-base">{phase.message}</p>
            <div>
              <Button asChild>
                <Link href="/cart">Review your cart</Link>
              </Button>
            </div>
          </div>
        );
      case "error":
        return (
          <div className={`${box} bg-surface`}>
            <p className="flex items-start gap-2 text-base font-bold text-danger">
              <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
              We couldn&apos;t verify your payment
            </p>
            <p className="text-base">{phase.message}</p>
            <div>
              <Button asChild variant="secondary">
                <Link href={orderUrl ?? "/track"}>View your order</Link>
              </Button>
            </div>
          </div>
        );
    }
  }

  return (
    <div
      aria-live="polite"
      role="status"
      className={className}
      data-testid="payment-status"
      data-phase={phase.kind}
    >
      {phase.kind === "idle" ? null : render()}
    </div>
  );
}
