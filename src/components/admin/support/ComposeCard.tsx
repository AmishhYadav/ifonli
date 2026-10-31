"use client";

import { Lock, Send } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  noteCaseAction,
  noteMessageAction,
  replyMessageAction,
  respondCaseAction,
} from "@/app/admin/(app)/support/actions";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Textarea } from "@/components/admin/ui";

import { useAct } from "./use-act";

type Kind = "message" | "case";

/** One textarea + button. Used for e-mail replies (`mode="reply"`) and staff-only notes (`mode="note"`). */
function ComposeForm({
  kind,
  id,
  mode,
  disabled,
  disabledReason,
}: {
  kind: Kind;
  id: string;
  mode: "reply" | "note";
  disabled?: boolean;
  disabledReason?: string;
}) {
  const act = useAct();
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const field = mode === "reply" ? "message" : "note";
  const fieldId = `${kind}-${mode}`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input = { [field]: text };
    act.run(
      () => {
        if (mode === "reply") return kind === "case" ? respondCaseAction(id, input) : replyMessageAction(id, input);
        return kind === "case" ? noteCaseAction(id, input) : noteMessageAction(id, input);
      },
      (data) => {
        setText("");
        const to = data.to;
        toast.success(mode === "reply" ? `E-mail queued${to ? ` to ${to}` : ""}` : "Note added");
      },
      (message, fields) => setError(fields?.[field] ?? message),
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <label htmlFor={fieldId} className="flex items-center gap-1.5 text-xs font-medium text-admin-ink-muted">
        {mode === "reply" ? (
          <>
            <Send className="size-3.5" aria-hidden /> Reply to the customer by e-mail
          </>
        ) : (
          <>
            <Lock className="size-3.5" aria-hidden /> Internal note (staff only)
          </>
        )}
      </label>
      <Textarea
        id={fieldId}
        rows={mode === "reply" ? 5 : 2}
        maxLength={mode === "reply" ? 4000 : 1000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={mode === "reply" ? "Write your reply" : "Visible to staff only"}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        disabled={disabled}
      />
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="text-xs text-admin-danger">
          {error}
        </p>
      ) : null}
      {disabled && disabledReason ? <p className="text-xs text-admin-ink-muted">{disabledReason}</p> : null}
      <div>
        <Button
          type="submit"
          variant={mode === "reply" ? "primary" : "outline"}
          size="sm"
          loading={act.pending}
          disabled={disabled || !text.trim()}
        >
          {mode === "reply" ? "Send reply" : "Add note"}
        </Button>
      </div>
    </form>
  );
}

export function ComposeCard({
  kind,
  id,
  customerEmail,
  replyDisabledReason,
}: {
  kind: Kind;
  id: string;
  customerEmail: string;
  /** Set when replying is not possible right now (e.g. a closed message). */
  replyDisabledReason?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reply and notes</CardTitle>
        <CardDescription>
          Replies are e-mailed to {customerEmail} with the next outbox run. Notes never leave the admin.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <ComposeForm kind={kind} id={id} mode="reply" disabled={Boolean(replyDisabledReason)} disabledReason={replyDisabledReason} />
        <ComposeForm kind={kind} id={id} mode="note" />
      </CardContent>
    </Card>
  );
}
