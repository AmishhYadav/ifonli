"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button, Checkbox, Field, Icon, Input, useToast } from "@/components/ui";
import { saveProfile } from "@/features/account/actions";
import { profileSchema, type ProfileInput, type ProfileValues } from "@/features/account/schema";

interface ProfileFormProps {
  email: string;
  initial: { name: string; phone: string | null; marketingOptIn: boolean };
}

export function ProfileForm({ email, initial }: ProfileFormProps) {
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<ProfileInput, unknown, ProfileValues>({
    resolver: zodResolver(profileSchema),
    mode: "onBlur",
    defaultValues: {
      name: initial.name,
      phone: initial.phone ?? "",
      marketingOptIn: initial.marketingOptIn,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const res = await saveProfile(values);
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    reset({ name: values.name, phone: values.phone ?? "", marketingOptIn: values.marketingOptIn });
    toast({ title: "Profile saved", tone: "success" });
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex max-w-xl flex-col gap-5"
      data-testid="profile-form"
    >
      <Field
        label="Email"
        hint="This is where your sign-in codes and order updates go. To change it, contact us from the help page."
      >
        <Input type="email" value={email} readOnly aria-readonly="true" />
      </Field>
      <Field label="Name" required error={errors.name?.message}>
        <Input autoComplete="name" {...register("name")} maxLength={100} />
      </Field>
      <Field
        label="Mobile number"
        hint="Optional. Used for delivery updates and to prefill checkout."
        error={errors.phone?.message}
      >
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          {...register("phone")}
          maxLength={32}
        />
      </Field>
      <Checkbox
        label="Send me news and offers by email"
        description="Optional. Order and delivery emails are always sent. You can change this any time."
        {...register("marketingOptIn")}
      />
      {serverError ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-semibold text-danger">
          <Icon name="alert-circle" className="mt-0.5 size-4" />
          {serverError}
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={isSubmitting} disabled={!isDirty && !isSubmitting}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
