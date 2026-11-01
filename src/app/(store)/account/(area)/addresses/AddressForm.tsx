"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field, Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import {
  accountAddressSchema,
  type AccountAddressInput,
  type AccountAddressValues,
  type SavedAddress,
} from "@/features/account/schema";
import { lookupPincode } from "@/features/checkout/actions";
import { PINCODE_PATTERN } from "@/features/checkout/schema";

import { saveAddressAction } from "../actions";

export interface AddressFormProps {
  /** Null = a new address. */
  address: SavedAddress | null;
  /** The first address is always the default; the box is then ticked and fixed. */
  isOnlyAddress: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

/** Add or edit one saved address. Same field rules as checkout; pincode fills city and state. */
export function AddressForm({ address, isOnlyAddress, onSaved, onCancel }: AddressFormProps) {
  const autofilled = useRef<{ city: string | null; state: string | null }>({ city: null, state: null });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState<{ pincode: string; place: string | null } | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    clearErrors,
    getValues,
    formState: { errors },
  } = useForm<AccountAddressInput, unknown, AccountAddressValues>({
    resolver: zodResolver(accountAddressSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      name: address?.name ?? "",
      phone: address?.phone ?? "",
      pincode: address?.pincode ?? "",
      city: address?.city ?? "",
      state: address?.state ?? "",
      line1: address?.line1 ?? "",
      line2: address?.line2 ?? "",
      landmark: address?.landmark ?? "",
      isDefault: address?.isDefault ?? isOnlyAddress,
    },
  });

  const rawPincode = (useWatch({ control, name: "pincode" }) ?? "").trim();
  const pincode = PINCODE_PATTERN.test(rawPincode) ? rawPincode : null;

  useEffect(() => {
    if (!pincode) return;
    let cancelled = false;
    void lookupPincode({ pincode }).then((res) => {
      if (cancelled) return;
      const data = res.ok ? res.data : null;
      setLookup({ pincode, place: data ? [data.city, data.state].filter(Boolean).join(", ") || null : null });
      if (!data) return;
      const fill = (field: "city" | "state", value: string | null) => {
        const current = getValues(field);
        if (value && (!current || current === autofilled.current[field])) {
          setValue(field, value, { shouldDirty: true });
          clearErrors(field);
          autofilled.current[field] = value;
        }
      };
      fill("city", data.city);
      fill("state", data.state);
    });
    return () => {
      cancelled = true;
    };
  }, [pincode, setValue, clearErrors, getValues]);

  const checking = pincode !== null && lookup?.pincode !== pincode;
  const place = pincode !== null && lookup?.pincode === pincode ? lookup.place : null;

  async function onValid(values: AccountAddressValues) {
    setProblem(null);
    setBusy(true);
    const result = await saveAddressAction(address?.id ?? null, values);
    setBusy(false);
    if (!result.ok) {
      for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
        setError(path as keyof AccountAddressInput, { type: "server", message });
      }
      setProblem(result.message);
      return;
    }
    onSaved();
  }

  return (
    <form
      id="address-form"
      noValidate
      onSubmit={handleSubmit(onValid)}
      className="flex flex-col gap-4"
      data-testid="address-form"
    >
      <Field label="Full name" required error={errors.name?.message}>
        <Input autoComplete="name" disabled={busy} {...register("name")} />
      </Field>
      <Field label="Mobile number" required hint="10 digits. The courier may call this number." error={errors.phone?.message}>
        <Input type="tel" inputMode="tel" autoComplete="tel" disabled={busy} {...register("phone")} />
      </Field>
      <Field
        label="Pincode"
        required
        className="sm:max-w-xs"
        hint={
          checking ? (
            <span className="inline-flex items-center gap-2">
              <Spinner className="size-4" /> Checking your pincode...
            </span>
          ) : place ? (
            `That's ${place}.`
          ) : (
            "6 digits. We'll fill in your city and state."
          )
        }
        error={errors.pincode?.message}
      >
        <Input
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          disabled={busy}
          {...register("pincode", {
            onChange: (e: { target: HTMLInputElement }) => {
              e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
            },
          })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City" required error={errors.city?.message}>
          <Input autoComplete="address-level2" disabled={busy} {...register("city")} />
        </Field>
        <Field label="State" required error={errors.state?.message}>
          <Input autoComplete="address-level1" disabled={busy} {...register("state")} />
        </Field>
      </div>
      <Field label="House or flat number and street" required error={errors.line1?.message}>
        <Input autoComplete="address-line1" disabled={busy} {...register("line1")} />
      </Field>
      <Field label="Area or locality (optional)" error={errors.line2?.message}>
        <Input autoComplete="address-line2" disabled={busy} {...register("line2")} />
      </Field>
      <Field label="Landmark (optional)" error={errors.landmark?.message}>
        <Input disabled={busy} {...register("landmark")} />
      </Field>
      <Checkbox
        label="Use as my default address"
        description={isOnlyAddress ? "Your first address is always the default." : "Checkout starts with this one."}
        disabled={busy || isOnlyAddress || address?.isDefault === true}
        {...register("isDefault")}
      />
      {problem ? (
        <p role="alert" className="flex items-start gap-2 text-base font-semibold text-danger" data-testid="address-error">
          <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} data-testid="address-save">
          {address ? "Save address" : "Add address"}
        </Button>
      </div>
    </form>
  );
}
