"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field, Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { profileSchema } from "@/features/account/schema";
import { fieldErrorsOf } from "@/features/account/schema";

import { saveProfileAction } from "../actions";

export interface ProfileFormProps {
  initial: { name: string; email: string; phone: string | null; marketingOptIn: boolean };
}

/** Name, mobile number and the marketing choice. The opt-in starts from what is stored (never pre-ticked). */
export function ProfileForm({ initial }: ProfileFormProps) {
  const { toast } = useToast();
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [marketing, setMarketing] = useState(initial.marketingOptIn);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    const values = { name, phone, marketingOptIn: marketing };
    const check = profileSchema.safeParse(values);
    if (!check.success) {
      setErrors(fieldErrorsOf(check.error));
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await saveProfileAction(values);
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      setProblem(result.message);
      return;
    }
    toast({ title: "Saved", description: "Your details are updated.", tone: "success" });
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4" data-testid="profile-form">
      <Field label="Email" hint="This is how you sign in. To use a different email, sign up again with it.">
        <Input value={initial.email} readOnly autoComplete="email" />
      </Field>
      <Field label="Full name" required error={errors.name}>
        <Input
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          data-testid="profile-name"
        />
      </Field>
      <Field label="Mobile number (optional)" hint="10 digits. Used only for delivery updates." error={errors.phone}>
        <Input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={busy}
          data-testid="profile-phone"
        />
      </Field>
      <Checkbox
        label="Email me news and offers"
        description="Optional. Order updates always reach you either way. You can change this any time."
        checked={marketing}
        onChange={(e) => setMarketing(e.target.checked)}
        disabled={busy}
        data-testid="profile-marketing"
      />
      {problem ? (
        <p role="alert" className="flex items-start gap-2 text-base font-semibold text-danger">
          <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
          {problem}
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={busy} data-testid="profile-save">
          Save changes
        </Button>
      </div>
    </form>
  );
}
