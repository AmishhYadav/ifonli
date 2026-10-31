"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";

import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Icon,
  Input,
  Select,
  useToast,
} from "@/components/ui";
import { makeAddressDefault, removeAddress, saveAddress } from "@/features/account/actions";
import {
  MAX_ADDRESSES,
  accountAddressSchema,
  type AccountAddressInput,
  type AccountAddressValues,
} from "@/features/account/schema";
import { lookupPincode } from "@/features/checkout/actions";
import { PINCODE_PATTERN } from "@/features/checkout/schema";
import { addressLines } from "@/components/orders/format";

export interface AddressView {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

interface AddressBookProps {
  addresses: AddressView[];
  states: string[];
}

/** Saved addresses: list, add, edit, delete, choose the default. Server state is refreshed by the actions. */
export function AddressBook({ addresses, states }: AddressBookProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const atLimit = addresses.length >= MAX_ADDRESSES;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(res.error ?? "Something went wrong. Please try again.");
      else toast({ title: done, tone: "success" });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-semibold text-danger">
          <Icon name="alert-circle" className="mt-0.5 size-4" />
          {error}
        </p>
      ) : null}

      {addresses.length === 0 && editing !== "new" ? (
        <EmptyState
          icon="map-pin"
          title="No saved addresses yet"
          action={
            <Button iconStart="plus" onClick={() => setEditing("new")}>
              Add an address
            </Button>
          }
        >
          Save an address and it will be ready the next time you check out.
        </EmptyState>
      ) : null}

      <ul className="grid gap-4 md:grid-cols-2" data-testid="address-list">
        {addresses.map((address) =>
          editing === address.id ? (
            <li key={address.id} className="md:col-span-2">
              <AddressForm
                address={address}
                states={states}
                isOnly={addresses.length === 1}
                onDone={() => setEditing(null)}
              />
            </li>
          ) : (
            <li
              key={address.id}
              className="flex flex-col gap-3 rounded-card border-token bg-surface p-4 shadow-card"
              data-testid="address-card"
            >
              <div className="flex items-start justify-between gap-2">
                <address className="flex flex-col text-base not-italic">
                  {addressLines(address).map((line, i) => (
                    <span key={i} className={i === 0 ? "font-semibold" : undefined}>
                      {line}
                    </span>
                  ))}
                  <span className="text-ink-muted">{address.phone}</span>
                </address>
                {address.isDefault ? <Badge tone="accent">Default</Badge> : null}
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  iconStart="edit"
                  onClick={() => setEditing(address.id)}
                >
                  Edit
                  <span className="sr-only"> address for {address.name}</span>
                </Button>
                {address.isDefault ? null : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(() => makeAddressDefault(address.id), "Default address updated")
                    }
                  >
                    Make default
                    <span className="sr-only"> address for {address.name}</span>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  iconStart="trash"
                  disabled={pending}
                  onClick={() => run(() => removeAddress(address.id), "Address removed")}
                >
                  Delete
                  <span className="sr-only"> address for {address.name}</span>
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>

      {editing === "new" ? (
        <AddressForm
          states={states}
          isOnly={addresses.length === 0}
          onDone={() => setEditing(null)}
        />
      ) : addresses.length > 0 ? (
        <div>
          <Button iconStart="plus" disabled={atLimit} onClick={() => setEditing("new")}>
            Add an address
          </Button>
          {atLimit ? (
            <p className="mt-2 text-sm text-ink-muted">
              You can save up to {MAX_ADDRESSES} addresses. Remove one to add another.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface AddressFormProps {
  address?: AddressView;
  states: string[];
  /** The first address is always the default, so the choice is not offered. */
  isOnly: boolean;
  onDone: () => void;
}

function AddressForm({ address, states, isOnly, onDone }: AddressFormProps) {
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    control,
    formState: { errors, isSubmitting },
  } = useForm<AccountAddressInput, unknown, AccountAddressValues>({
    resolver: zodResolver(accountAddressSchema),
    mode: "onBlur",
    shouldFocusError: true,
    defaultValues: {
      name: address?.name ?? "",
      phone: address?.phone ?? "",
      pincode: address?.pincode ?? "",
      line1: address?.line1 ?? "",
      line2: address?.line2 ?? "",
      landmark: address?.landmark ?? "",
      city: address?.city ?? "",
      state: address?.state ?? "",
      isDefault: address?.isDefault ?? false,
    },
  });

  // A valid pincode fills city and state (the user can still change them).
  const pincode = (useWatch({ control, name: "pincode" }) ?? "").trim();
  const lastLooked = useRef(address?.pincode ?? "");
  useEffect(() => {
    if (!PINCODE_PATTERN.test(pincode) || lastLooked.current === pincode) return;
    lastLooked.current = pincode;
    let cancelled = false;
    void lookupPincode({ pincode }).then((res) => {
      if (cancelled || !res.ok) return;
      if (res.data.city) {
        setValue("city", res.data.city, { shouldDirty: true });
        clearErrors("city");
      }
      if (res.data.state && states.includes(res.data.state)) {
        setValue("state", res.data.state, { shouldDirty: true });
        clearErrors("state");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pincode, setValue, clearErrors, states]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const res = await saveAddress({ ...values, ...(address ? { id: address.id } : {}) });
    if (!res.ok) {
      const stateMessage = res.fieldErrors?.state;
      if (stateMessage) setError("state", { message: stateMessage });
      else setServerError(res.error);
      return;
    }
    toast({ title: address ? "Address saved" : "Address added", tone: "success" });
    onDone();
  });

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      aria-label={address ? "Edit address" : "Add an address"}
      className="flex flex-col gap-4 rounded-card border-token bg-surface p-4 shadow-card sm:p-5"
      data-testid="address-form"
    >
      <h2 className="font-display text-xl leading-tight">
        {address ? "Edit address" : "Add an address"}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={errors.name?.message}>
          <Input autoComplete="name" {...register("name")} maxLength={100} />
        </Field>
        <Field label="Mobile number" required error={errors.phone?.message}>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            {...register("phone")}
            maxLength={32}
          />
        </Field>
        <Field
          label="Pincode"
          required
          hint="6 digits. We'll fill in your city and state."
          error={errors.pincode?.message}
        >
          <Input
            inputMode="numeric"
            autoComplete="postal-code"
            {...register("pincode")}
            maxLength={6}
          />
        </Field>
        <Field
          label="House or flat number and street"
          required
          error={errors.line1?.message}
          className="sm:col-span-2"
        >
          <Input autoComplete="address-line1" {...register("line1")} maxLength={200} />
        </Field>
        <Field
          label="Address line 2"
          hint="Optional"
          error={errors.line2?.message}
          className="sm:col-span-2"
        >
          <Input autoComplete="address-line2" {...register("line2")} maxLength={200} />
        </Field>
        <Field
          label="Landmark"
          hint="Optional"
          error={errors.landmark?.message}
          className="sm:col-span-2"
        >
          <Input {...register("landmark")} maxLength={120} />
        </Field>
        <Field label="City" required error={errors.city?.message}>
          <Input autoComplete="address-level2" {...register("city")} maxLength={80} />
        </Field>
        <Field label="State" required error={errors.state?.message}>
          <Select autoComplete="address-level1" {...register("state")}>
            <option value="">Choose your state</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {isOnly || address?.isDefault ? null : (
        <Checkbox label="Make this my default address" {...register("isDefault")} />
      )}
      {serverError ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-semibold text-danger">
          <Icon name="alert-circle" className="mt-0.5 size-4" />
          {serverError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={isSubmitting}>
          {address ? "Save address" : "Add address"}
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
