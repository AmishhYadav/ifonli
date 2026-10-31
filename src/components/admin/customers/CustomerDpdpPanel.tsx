"use client";

import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { deleteCustomerAction, exportCustomerAction } from "@/app/admin/(app)/customers/actions";
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
} from "@/components/admin/ui";

export interface CustomerDpdpPanelProps {
  /** URL reference of the customer (user id, or `o-<order id>` for a guest). */
  customerRef: string;
  kind: "account" | "guest";
  email: string;
  /** Permission flags for the signed-in role (the server re-checks every action). */
  allow: { export: boolean; delete: boolean };
}

/** Saves text as a file in the browser (no round trip: the Server Action already returned the content). */
function saveFile(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/**
 * DPDP request handling: "Export data" (access request) and "Delete account" (erasure request, typed
 * confirmation). A guest has no account to delete: their orders are retained records, and the panel
 * says so instead of offering the button.
 */
export function CustomerDpdpPanel({ customerRef, kind, email, allow }: CustomerDpdpPanelProps) {
  const [pending, start] = React.useTransition();
  const [deleting, setDeleting] = React.useState(false);

  function exportData() {
    start(async () => {
      const res = await exportCustomerAction(customerRef);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      saveFile(res.data.filename, res.data.content);
      toast.success("Export downloaded. It was recorded in the audit log.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" aria-hidden /> Data requests (DPDP)
        </CardTitle>
        <CardDescription>
          Answer a customer&apos;s request to see or erase their personal data. Both actions are
          recorded in the audit log.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-[13px]">
        {allow.export ? (
          <div className="grid gap-1.5">
            <Button variant="outline" onClick={exportData} loading={pending}>
              <Download aria-hidden /> Export data
            </Button>
            <p className="text-xs text-admin-ink-muted">
              {kind === "account"
                ? "A JSON file with the profile, addresses, orders, wishlist, support cases and contact messages."
                : "A JSON file with the orders, support cases and contact messages held for this e-mail address."}
            </p>
          </div>
        ) : null}

        {kind === "account" ? (
          allow.delete ? (
            <div className="grid gap-1.5">
              <Button variant="danger-outline" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden /> Delete account
              </Button>
              <p className="text-xs text-admin-ink-muted">
                Removes the login, profile, saved addresses and wishlist. Orders are kept (tax and
                accounting records) but no longer belong to an account.
              </p>
            </div>
          ) : null
        ) : (
          <p className="rounded-md bg-admin-surface-2 p-3 text-xs text-admin-ink-muted">
            <strong className="font-medium text-admin-ink">
              This guest has no account to delete.
            </strong>{" "}
            Their orders hold the name, address and phone given at checkout and are tax and
            accounting records that must be kept (decision D-DPDP-1), so they cannot be erased here.
            Export their data to answer an access request.
          </p>
        )}
        {!allow.export && !allow.delete ? (
          <p className="text-xs text-admin-ink-muted">
            Your role cannot export or delete customer data.
          </p>
        ) : null}
      </CardContent>
      {deleting ? (
        <DeleteDialog customerRef={customerRef} email={email} onClose={() => setDeleting(false)} />
      ) : null}
    </Card>
  );
}

function DeleteDialog({
  customerRef,
  email,
  onClose,
}: {
  customerRef: string;
  email: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();
  const matches = confirm.trim().toLowerCase() === email.toLowerCase();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    start(async () => {
      const res = await deleteCustomerAction(customerRef, { confirm });
      if (!res.ok) {
        setError(res.fieldErrors?.confirm ?? res.error);
        return;
      }
      toast.success(
        res.data.ordersRetained > 0
          ? `Account deleted. ${res.data.ordersRetained} order${res.data.ordersRetained === 1 ? " was" : "s were"} kept as records.`
          : "Account deleted.",
      );
      onClose();
      router.push("/admin/customers");
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Delete this account?</DialogTitle>
            <DialogDescription>
              The customer&apos;s login, profile, saved addresses, wishlist and open carts are
              erased and they are signed out everywhere. Orders and invoices are kept as legal
              records. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <Field
            label={
              <>
                Type <span className="font-mono">{email}</span> to confirm
              </>
            }
            htmlFor="delete-confirm"
            required
            error={error}
          >
            <Input
              id="delete-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              autoFocus
              aria-invalid={error ? true : undefined}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={pending} disabled={!matches}>
              Delete account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
