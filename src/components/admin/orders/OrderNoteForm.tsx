"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { addNoteAction } from "@/app/admin/(app)/orders/actions";
import { Button, Textarea } from "@/components/admin/ui";

/** Internal note: lands on the timeline, never shown to the customer. */
export function OrderNoteForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await addNoteAction(orderId, { note });
      if (!res.ok) {
        setError(res.fieldErrors?.note ?? res.error);
        return;
      }
      setNote("");
      toast.success("Note added");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <label htmlFor="order-note" className="text-xs font-medium text-admin-ink-muted">
        Add an internal note
      </label>
      <Textarea
        id="order-note"
        rows={2}
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Visible to staff only"
        aria-invalid={Boolean(error)}
      />
      {error ? (
        <p role="alert" className="text-xs text-admin-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="outline" size="sm" loading={pending} disabled={!note.trim()}>
          Add note
        </Button>
      </div>
    </form>
  );
}
