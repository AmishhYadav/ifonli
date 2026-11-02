"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { PaymentStatusPanel } from "@/components/checkout/PaymentStatusPanel";
import { usePayment } from "@/components/checkout/usePayment";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export interface PayNowPanelProps {
  orderRef: string;
  token: string;
  email: string;
  /** Pre-formatted payable amount, e.g. "₹1,299". */
  amountLabel: string;
  /** Pre-formatted hold deadline ("3:42 pm"), if known. */
  holdUntil: string | null;
}

const REFRESH_EVERY_MS = 5000;
const MAX_REFRESHES = 6;

/**
 * "Payment pending - Retry" on the order page. Re-opens payment on the same provider order. While the
 * order is waiting the page also re-reads itself a few times, so a payment confirmed by the webhook
 * shows up without a manual reload.
 */
export function PayNowPanel({ orderRef, token, email, amountLabel, holdUntil }: PayNowPanelProps) {
  const router = useRouter();
  const pay = usePayment({ order: { ref: orderRef, token }, onPaid: () => router.refresh() });

  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= MAX_REFRESHES) clearInterval(timer);
    }, REFRESH_EVERY_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div
      className="flex flex-col gap-3 rounded-card bg-surface shadow-card p-4"
      data-testid="pay-now"
    >
      <p className="flex items-start gap-2 text-base font-bold">
        <Icon name="info" className="mt-0.5 size-5 flex-none" />
        Payment pending
      </p>
      <p className="text-base">
        We haven&apos;t received your payment of {amountLabel} yet.
        {holdUntil ? ` Your items are held until about ${holdUntil}.` : null} If you&apos;ve already
        paid, please don&apos;t pay again: it can take a few minutes to confirm, and this page will
        update.
      </p>
      {pay.phase.kind === "idle" ? (
        <div>
          <Button onClick={() => void pay.retry()} iconStart="refresh" data-testid="payment-retry">
            Retry payment
          </Button>
        </div>
      ) : (
        <PaymentStatusPanel
          phase={pay.phase}
          onRetry={() => void pay.retry()}
          orderUrl={pay.orderUrl}
          email={email}
        />
      )}
      {pay.mockDialog}
    </div>
  );
}
