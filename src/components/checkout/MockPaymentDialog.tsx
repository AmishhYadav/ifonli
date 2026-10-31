"use client";

import { useState } from "react";

import { Button, Dialog, DialogContent } from "@/components/ui";
import type { RazorpayCheckoutPayload } from "@/features/checkout/types";
import { formatINR } from "@/lib/money";

import type { RazorpaySuccessResponse } from "./razorpay";

type MockOutcome = "success" | "failure";

interface MockResponse {
  ok: boolean;
  checkout?: RazorpaySuccessResponse;
  error?: { description?: string | null };
}

export interface MockPaymentDialogProps {
  payload: RazorpayCheckoutPayload;
  onSuccess: (fields: RazorpaySuccessResponse) => void;
  onFailed: (message: string | null) => void;
  onDismiss: () => void;
}

/**
 * DEV ONLY stand-in for the Razorpay popup, shown when the server hands out a `mock` payload (no
 * Razorpay keys, development). Production never gets such a payload, and the route it calls answers 404.
 */
export function MockPaymentDialog({
  payload,
  onSuccess,
  onFailed,
  onDismiss,
}: MockPaymentDialogProps) {
  const [busy, setBusy] = useState<MockOutcome | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(outcome: MockOutcome) {
    setBusy(outcome);
    setProblem(null);
    try {
      const res = await fetch("/api/dev/mock-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ razorpayOrderId: payload.razorpayOrderId, outcome }),
      });
      const body = (await res.json().catch(() => null)) as MockResponse | null;
      if (!res.ok || !body?.ok) {
        setProblem("The dev payment mock isn't available. Is a real Razorpay key set?");
        setBusy(null);
        return;
      }
      if (outcome === "success" && body.checkout) onSuccess(body.checkout);
      else onFailed(body.error?.description ?? "The test payment failed.");
    } catch {
      setProblem("Couldn't reach the dev payment mock.");
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onDismiss()}>
      <DialogContent
        title="Test payment (dev mock)"
        description={`Development only. No money moves. Pretend to pay ${formatINR(payload.amountPaise)} for ${payload.description ?? "this order"}.`}
        data-testid="mock-payment"
        hideClose
        footer={
          <>
            <Button
              variant="ghost"
              onClick={onDismiss}
              disabled={busy !== null}
              data-testid="mock-dismiss"
            >
              Dismiss
            </Button>
            <Button
              variant="secondary"
              onClick={() => void run("failure")}
              loading={busy === "failure"}
              disabled={busy === "success"}
              data-testid="mock-failure"
            >
              Failure
            </Button>
            <Button
              onClick={() => void run("success")}
              loading={busy === "success"}
              disabled={busy === "failure"}
              data-testid="mock-success"
            >
              Success
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Razorpay order <code className="break-all">{payload.razorpayOrderId}</code>
        </p>
        {problem ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {problem}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
