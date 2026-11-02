"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { retryPayment } from "@/features/checkout/actions";
import type { RazorpayCheckoutPayload } from "@/features/checkout/types";

import { MockPaymentDialog } from "./MockPaymentDialog";
import { openRazorpayCheckout, type RazorpaySuccessResponse } from "./razorpay";

export type PaymentPhase =
  | { kind: "idle" }
  /** Loading Checkout.js / asking the server to (re)open the provider order. */
  | { kind: "opening" }
  /** The Razorpay popup (or the dev mock dialog) is open. */
  | { kind: "open" }
  | { kind: "verifying" }
  /** Dismissed or failed: the order is still waiting, Retry re-opens the same provider order. */
  | { kind: "incomplete"; reason: string | null }
  /** The server could not confirm yet; the webhook will. Do not pay again. */
  | { kind: "confirming" }
  | { kind: "expired"; message: string }
  | { kind: "error"; message: string };

/** Waits before each verify attempt after a 409 / 5xx / network error (ms); the first goes straight away. */
const VERIFY_DELAYS_MS = [0, 2000, 4000, 8000] as const;
const MAX_RETRY_AFTER_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type VerifyResult = "paid" | "pending" | { fatal: string };

async function postVerify(
  fields: RazorpaySuccessResponse,
  ref: string,
  token: string,
): Promise<VerifyResult | { wait: number }> {
  let res: Response;
  try {
    res = await fetch("/api/payments/razorpay/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, ref, token }),
    });
  } catch {
    return "pending";
  }
  if (res.ok) return "paid";
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    retryAfterSeconds?: number;
  } | null;
  if (res.status === 429) {
    return { wait: Math.min((body?.retryAfterSeconds ?? 5) * 1000, MAX_RETRY_AFTER_MS) };
  }
  if (res.status === 409 || res.status >= 500) return "pending";
  return {
    fatal: `We couldn't verify this payment. If money was taken from your account, please contact us with order reference ${ref} and we'll sort it out.`,
  };
}

/** The order being paid: its reference and the guest access token (the `?t=` value). */
export interface PayableOrder {
  ref: string;
  token: string;
}

export interface UsePaymentOptions {
  /** Known up front on the order page; `start()` supplies it right after `placeOrder` at checkout. */
  order?: PayableOrder;
  /** Called once the payment is confirmed (default: go to the order page). */
  onPaid?: () => void;
}

export interface UsePayment {
  phase: PaymentPhase;
  /** Opens payment for a payload returned by `placeOrder`. */
  start: (payload: RazorpayCheckoutPayload, order?: PayableOrder) => void;
  /** Asks for a fresh payload on the same provider order and opens it. */
  retry: (order?: PayableOrder) => Promise<void>;
  /** Render this somewhere in the tree: the dev mock dialog (null outside the dev mock). */
  mockDialog: ReactNode;
  /** True while a popup, verification or retry is in flight. */
  busy: boolean;
  /** Order page link (with the access token), once an order is known. */
  orderUrl: string | null;
}

/**
 * Prepaid payment lifecycle for one order (plan 7.6): open Checkout.js (or the dev mock), verify on the
 * server, then go to the order page. Dismissing or a failed attempt leaves the order waiting (Retry);
 * when verification cannot be completed it polls a few times and then tells the customer it is being
 * confirmed (the webhook is the backstop).
 */
export function usePayment({ order: initialOrder, onPaid }: UsePaymentOptions = {}): UsePayment {
  const router = useRouter();
  const [phase, setPhase] = useState<PaymentPhase>({ kind: "idle" });
  const [mock, setMock] = useState<RazorpayCheckoutPayload | null>(null);
  const [order, setOrder] = useState<PayableOrder | null>(initialOrder ?? null);
  const orderRef = useRef<PayableOrder | null>(initialOrder ?? null);
  const alive = useRef(true);
  /** One per start(): late callbacks of an earlier attempt are ignored. */
  const attempt = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const orderUrl = order
    ? `/orders/${encodeURIComponent(order.ref)}?t=${encodeURIComponent(order.token)}`
    : null;

  const remember = useCallback((next: PayableOrder | undefined) => {
    if (!next) return;
    orderRef.current = next;
    setOrder(next);
  }, []);

  const finish = useCallback(() => {
    const current = orderRef.current;
    if (onPaid) onPaid();
    else if (current)
      router.replace(
        `/orders/${encodeURIComponent(current.ref)}?t=${encodeURIComponent(current.token)}`,
      );
  }, [onPaid, router]);

  const verify = useCallback(
    async (fields: RazorpaySuccessResponse) => {
      const current = orderRef.current;
      if (!current) return;
      setMock(null);
      setPhase({ kind: "verifying" });
      let extra = 0;
      for (const delay of VERIFY_DELAYS_MS) {
        await sleep(delay + extra);
        extra = 0;
        if (!alive.current) return;
        const result = await postVerify(fields, current.ref, current.token);
        if (!alive.current) return;
        if (result === "paid") return finish();
        if (typeof result === "object" && "fatal" in result) {
          return setPhase({ kind: "error", message: result.fatal });
        }
        if (typeof result === "object") extra = result.wait;
      }
      setPhase({ kind: "confirming" });
    },
    [finish],
  );

  const start = useCallback(
    (payload: RazorpayCheckoutPayload, next?: PayableOrder) => {
      remember(next);
      const mine = ++attempt.current;
      const current = () => alive.current && attempt.current === mine;
      setPhase({ kind: "opening" });

      if (payload.mock) {
        // Dev only: no Checkout.js, the dialog drives /api/dev/mock-checkout.
        setMock(payload);
        setPhase({ kind: "open" });
        return;
      }

      let settled = false;
      openRazorpayCheckout(payload, {
        onSuccess: (response) => {
          if (!current()) return;
          settled = true;
          void verify(response);
        },
        onDismiss: () => {
          if (!current() || settled) return;
          setPhase((prev) =>
            prev.kind === "incomplete" ? prev : { kind: "incomplete", reason: null },
          );
        },
        onFailed: (message) => {
          if (!current() || settled) return;
          setPhase({ kind: "incomplete", reason: message });
        },
      })
        .then(() => {
          if (current()) setPhase((prev) => (prev.kind === "opening" ? { kind: "open" } : prev));
        })
        .catch(() => {
          if (!current()) return;
          setPhase({
            kind: "incomplete",
            reason: "We couldn't open the payment window. Check your connection and try again.",
          });
        });
    },
    [remember, verify],
  );

  const retry = useCallback(
    async (next?: PayableOrder) => {
      remember(next);
      const current = orderRef.current;
      if (!current) return;
      setPhase({ kind: "opening" });
      const result = await retryPayment(current.ref, current.token);
      if (!alive.current) return;
      if (result.ok) return start(result.data.payment);
      const { code, message } = result.error;
      if (code === "already_paid") return finish();
      if (code === "expired" || code === "not_retryable" || code === "not_found") {
        return setPhase({
          kind: "expired",
          message:
            code === "expired"
              ? "The time held for this payment has run out, so your items were released. Please review your bag and place the order again."
              : message,
        });
      }
      setPhase({ kind: "incomplete", reason: message });
    },
    [finish, remember, start],
  );

  const mockDialog = mock ? (
    <MockPaymentDialog
      payload={mock}
      onSuccess={(fields) => void verify(fields)}
      onFailed={(message) => {
        setMock(null);
        setPhase({ kind: "incomplete", reason: message });
      }}
      onDismiss={() => {
        setMock(null);
        setPhase({ kind: "incomplete", reason: null });
      }}
    />
  ) : null;

  return {
    phase,
    start,
    retry,
    mockDialog,
    busy: phase.kind === "opening" || phase.kind === "open" || phase.kind === "verifying",
    orderUrl,
  };
}
