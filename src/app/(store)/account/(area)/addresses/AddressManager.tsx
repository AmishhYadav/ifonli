"use client";

import { useState } from "react";

import { addressLines } from "@/components/orders/format";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  Icon,
  useToast,
} from "@/components/ui";
import { MAX_SAVED_ADDRESSES, type SavedAddress } from "@/features/account/schema";

import { makeDefaultAddressAction, removeAddressAction } from "../actions";
import { AddressForm } from "./AddressForm";

/** Saved addresses: list, add, edit, make default, delete (with confirmation). Exactly one default. */
export function AddressManager({ addresses }: { addresses: SavedAddress[] }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<SavedAddress | "new" | null>(null);
  const [removing, setRemoving] = useState<SavedAddress | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const atLimit = addresses.length >= MAX_SAVED_ADDRESSES;

  async function makeDefault(address: SavedAddress) {
    setBusyId(address.id);
    setError(null);
    const result = await makeDefaultAddressAction(address.id);
    setBusyId(null);
    if (!result.ok) setError(result.message);
    else toast({ title: "Default address changed", tone: "success" });
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusyId(removing.id);
    setError(null);
    const result = await removeAddressAction(removing.id);
    setBusyId(null);
    setRemoving(null);
    if (!result.ok) setError(result.message);
    else toast({ title: "Address removed", tone: "success" });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-ink-muted" data-testid="address-count">
          {addresses.length === 0
            ? "No saved addresses yet."
            : `${addresses.length} of ${MAX_SAVED_ADDRESSES} saved.`}
        </p>
        <Button iconStart="plus" onClick={() => setEditing("new")} disabled={atLimit} data-testid="add-address">
          Add an address
        </Button>
      </div>
      {atLimit ? (
        <p className="text-sm text-ink-muted">You&apos;ve reached {MAX_SAVED_ADDRESSES} addresses. Remove one to add another.</p>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-base font-semibold text-danger">
          <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
          {error}
        </p>
      ) : null}

      {addresses.length === 0 ? (
        <EmptyState icon="map-pin" headingLevel="h2" title="Save an address for faster checkout">
          Checkout fills in your default address, so you only need to pick how to pay.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" data-testid="address-list">
          {addresses.map((address) => (
            <li key={address.id}>
              <Card as="article" className="flex h-full flex-col gap-3" data-testid="address-card">
                <div className="flex items-start justify-between gap-3">
                  <address className="not-italic">
                    {addressLines(address).map((line, i) => (
                      <span key={i} className={i === 0 ? "block font-semibold" : "block"}>
                        {line}
                      </span>
                    ))}
                    <span className="block text-ink-muted">{address.phone}</span>
                  </address>
                  {address.isDefault ? (
                    <Badge tone="success" data-testid="address-default-badge">
                      Default
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditing(address)}
                    aria-label={`Edit address for ${address.name}, ${address.pincode}`}
                  >
                    Edit
                  </Button>
                  {!address.isDefault ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busyId === address.id}
                      onClick={() => void makeDefault(address)}
                      aria-label={`Make the address for ${address.name}, ${address.pincode} the default`}
                    >
                      Make default
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoving(address)}
                    aria-label={`Remove address for ${address.name}, ${address.pincode}`}
                  >
                    Remove
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent
          title={editing === "new" ? "Add an address" : "Edit address"}
          description="We use this to fill in checkout. Orders keep their own copy of the address."
          className="max-w-xl"
        >
          {editing !== null ? (
            <AddressForm
              key={editing === "new" ? "new" : editing.id}
              address={editing === "new" ? null : editing}
              isOnlyAddress={editing === "new" ? addresses.length === 0 : addresses.length === 1}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                toast({ title: editing === "new" ? "Address added" : "Address saved", tone: "success" });
                setEditing(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent
          title="Remove this address?"
          description={removing ? addressLines(removing).join(", ") : undefined}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="secondary">Keep it</Button>
              </DialogClose>
              <Button loading={busyId !== null && busyId === removing?.id} onClick={() => void confirmRemove()} data-testid="address-remove-confirm">
                Yes, remove
              </Button>
            </>
          }
        >
          <p className="text-base text-ink-muted">Past orders keep the address they were sent to.</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
