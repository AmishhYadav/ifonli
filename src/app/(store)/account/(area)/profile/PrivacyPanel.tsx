"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardTitle } from "@/components/ui/Card";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";

import { deleteAccountAction } from "../actions";

/**
 * DPDP: "Download my data" and "Delete my account". The delete button opens a confirmation that says
 * plainly what goes and what stays (orders are kept for tax and legal records).
 */
export function PrivacyPanel() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    // On success the action redirects (this call never returns); on failure we get the message back.
    const result = await deleteAccountAction();
    if (result && !result.ok) {
      setBusy(false);
      setError(result.message);
    }
  }

  return (
    <Card as="section" aria-labelledby="privacy-heading" data-testid="privacy-panel">
      <CardTitle id="privacy-heading" as="h2" className="mb-3">
        Your data
      </CardTitle>
      <CardBody className="gap-5">
        <div className="flex flex-col gap-2">
          <h3 className="font-body text-base font-semibold">Download my data</h3>
          <p className="text-base text-ink-muted">
            A file with your profile, addresses, orders, wishlist and the reports you&apos;ve sent us.
          </p>
          <div>
            <Button asChild variant="secondary" iconStart="upload">
              <a href="/api/account/export" download data-testid="export-data">
                Download my data
              </a>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-hairline pt-5">
          <h3 className="font-body text-base font-semibold">Delete my account</h3>
          <p className="text-base text-ink-muted">
            This removes your sign-in, saved addresses, wishlist and profile. We keep your past orders and
            invoices because the law requires us to keep tax records.
          </p>
          <Dialog
            open={open}
            onOpenChange={(next) => {
              if (busy) return;
              setOpen(next);
              if (!next) setError(null);
            }}
          >
            <div>
              <DialogTrigger asChild>
                <Button variant="secondary" iconStart="trash" data-testid="delete-account">
                  Delete my account
                </Button>
              </DialogTrigger>
            </div>
            <DialogContent
              title="Delete your account?"
              description="This can't be undone."
              footer={
                <>
                  <DialogClose asChild>
                    <Button variant="secondary" disabled={busy}>
                      Keep my account
                    </Button>
                  </DialogClose>
                  <Button loading={busy} onClick={() => void remove()} data-testid="delete-confirm">
                    Yes, delete my account
                  </Button>
                </>
              }
            >
              <div className="flex flex-col gap-3">
                <p className="text-base">We will delete:</p>
                <ul className="list-disc pl-6 text-base">
                  <li>your sign-in and any active sessions</li>
                  <li>your profile, including your phone number</li>
                  <li>your saved addresses and wishlist</li>
                </ul>
                <p className="text-base">We will keep:</p>
                <ul className="list-disc pl-6 text-base">
                  <li>
                    your past orders and invoices, with the name and address you gave at checkout, for tax and
                    legal records. They will no longer be linked to an account.
                  </li>
                </ul>
                <p className="text-base">
                  Orders that are still on their way will be delivered as usual. You can download your data
                  first if you want a copy.
                </p>
                {error ? (
                  <p role="alert" className="flex items-start gap-2 text-base font-semibold text-danger">
                    <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
                    {error}
                  </p>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardBody>
    </Card>
  );
}
