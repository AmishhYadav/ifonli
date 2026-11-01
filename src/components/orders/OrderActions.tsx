"use client";

import Link from "next/link";

import { Button } from "@/components/ui/Button";
import type { SupportType } from "@/features/orders/support-schema";
import { formatINR } from "@/lib/money";

import { CancelOrderDialog } from "./CancelOrderDialog";
import { ReportProblemDialog } from "./ReportProblemDialog";

export interface OrderActionsProps {
  orderRef: string;
  /** Guest `?t=` token; omitted when a signed-in customer is looking at their own order. */
  token?: string;
  email: string;
  paymentMethod: "razorpay" | "cod";
  totalPaise: number;
  /** Download link for the invoice, or null before one exists. */
  invoiceHref: string | null;
  cancel: { available: boolean; hint: string | null };
  report: {
    types: SupportType[];
    claimWindowHours: number;
    windowEnded: boolean;
    photosAvailable: boolean;
  };
  /** Guests only: where "Create an account" goes (prefilled e-mail). Null when signed in. */
  createAccountHref: string | null;
}

/**
 * The buttons under "Need help?": invoice, cancel, report a problem, create an account. The same
 * component serves the guest `?t=` page and the account order page.
 */
export function OrderActions({
  orderRef,
  token,
  email,
  paymentMethod,
  totalPaise,
  invoiceHref,
  cancel,
  report,
  createAccountHref,
}: OrderActionsProps) {
  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="order-actions">
      {invoiceHref ? (
        <Button asChild variant="secondary" iconStart="copy">
          {/* A plain link: the route redirects to a short-lived signed PDF link. */}
          <a href={invoiceHref} data-testid="download-invoice">
            Download invoice
          </a>
        </Button>
      ) : null}

      {cancel.available ? (
        <CancelOrderDialog
          orderRef={orderRef}
          token={token}
          paymentMethod={paymentMethod}
          totalLabel={formatINR(totalPaise)}
        />
      ) : cancel.hint ? (
        <p className="text-sm text-ink-muted" data-testid="cancel-hint">
          {cancel.hint}
        </p>
      ) : null}

      <ReportProblemDialog
        orderRef={orderRef}
        token={token}
        types={report.types}
        claimWindowHours={report.claimWindowHours}
        windowEnded={report.windowEnded}
        photosAvailable={report.photosAvailable}
        email={email}
      />

      {createAccountHref ? (
        <div className="mt-1 flex flex-col gap-1">
          <Button asChild variant="secondary" iconStart="user">
            <Link href={createAccountHref} data-testid="create-account">
              Create an account
            </Link>
          </Button>
          <p className="text-sm text-ink-muted">
            Optional. We&apos;ll email you a code to sign in, then show this order and any others from {email}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
