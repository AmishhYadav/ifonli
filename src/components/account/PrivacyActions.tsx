"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Field, Icon, Input, useToast } from "@/components/ui";
import { deleteMyAccount } from "@/features/account/actions";
import { DELETE_CONFIRMATION } from "@/features/account/schema";
import { goDeviceOnly } from "@/features/wishlist/account-sync";

/** Typed confirmation, then the irreversible deletion. The device wishlist is left alone. */
export function DeleteAccountForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = value.trim().toUpperCase() === DELETE_CONFIRMATION;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await deleteMyAccount({ confirmation: value });
      if (!res.ok) {
        setError(res.fieldErrors?.confirmation ?? res.error);
        return;
      }
      goDeviceOnly();
      toast({ title: "Your account has been deleted", tone: "success", duration: 8000 });
      router.replace("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      className="flex max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void submit();
      }}
      data-testid="delete-account-form"
    >
      <Field label={`Type ${DELETE_CONFIRMATION} to confirm`} error={error ?? undefined}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </Field>
      <div>
        <Button
          type="submit"
          variant="secondary"
          iconStart="trash"
          loading={busy}
          disabled={!ready}
          className="border-danger text-danger"
        >
          Delete my account
        </Button>
      </div>
      <p className="flex items-start gap-1.5 text-sm text-ink-muted">
        <Icon name="info" className="mt-0.5 size-4 flex-none" />
        This cannot be undone.
      </p>
    </form>
  );
}
