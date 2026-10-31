"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { createCouponAction, updateCouponAction } from "@/app/admin/(app)/discounts/actions";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Form,
  Input,
  Select,
  Switch,
  cn,
} from "@/components/admin/ui";
import type { CouponFormOptions } from "@/server/services/admin/discounts";

import {
  couponFormSchema,
  formToInput,
  serviceFieldToForm,
  type CouponFormValues,
} from "./form-values";

function CheckList({
  legend,
  options,
  value,
  onChange,
  hint,
  error,
}: {
  legend: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  hint?: string;
  error?: string;
}) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q) || value.includes(o.value)) : options;
  const searchable = options.length > 8;
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1 text-sm font-medium text-admin-ink">
        {legend} {value.length > 0 ? <span className="font-normal text-admin-ink-muted">({value.length} selected)</span> : null}
      </legend>
      {searchable ? (
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${legend.toLowerCase()}`} aria-label={`Search ${legend}`} className="h-8" />
      ) : null}
      <div className={cn("grid gap-1 rounded-md border border-admin-border p-2", searchable && "max-h-44 overflow-y-auto")}>
        {shown.length === 0 ? <p className="text-xs text-admin-ink-muted">Nothing to choose from.</p> : null}
        {shown.map((o) => {
          const id = `${legend}-${o.value}`.replace(/\W+/g, "-");
          const checked = value.includes(o.value);
          return (
            <label key={o.value} htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-admin-surface-2">
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(c) => onChange(c === true ? [...value, o.value] : value.filter((v) => v !== o.value))}
              />
              {o.label}
            </label>
          );
        })}
      </div>
      {hint && !error ? <p className="text-xs text-admin-ink-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-admin-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function CouponForm({
  couponId,
  defaultValues,
  options,
  locked,
  canManage = true,
}: {
  couponId: string | null;
  defaultValues: CouponFormValues;
  options: CouponFormOptions;
  /** The code has been used and can no longer be renamed. */
  locked: boolean;
  canManage?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const form = useForm<CouponFormValues>({
    resolver: zodResolver(couponFormSchema),
    defaultValues,
    mode: "onTouched",
  });
  const { control, register, handleSubmit, setError, formState, reset } = form;
  const { errors } = formState;
  const kind = useWatch({ control, name: "kind" });
  const [formError, setFormError] = React.useState<string | null>(null);

  function onSubmit(values: CouponFormValues) {
    setFormError(null);
    start(async () => {
      const input = formToInput(values);
      const res = couponId ? await updateCouponAction(couponId, input) : await createCouponAction(input);
      if (!res.ok) {
        let shown = false;
        for (const [path, message] of Object.entries(res.fieldErrors ?? {})) {
          const field = serviceFieldToForm(path, values.kind);
          if (field === "form") continue;
          setError(field, { message });
          shown = true;
        }
        if (!shown) setFormError(res.error);
        else toast.error(res.error);
        return;
      }
      toast.success(couponId ? `${res.data.code} saved` : `${res.data.code} created`);
      if (couponId) {
        reset(values);
        router.refresh();
      } else {
        router.push(`/admin/discounts/${res.data.id}`);
      }
    });
  }

  const err = (k: keyof CouponFormValues) => {
    const e = errors[k] as { message?: unknown } | undefined;
    return typeof e?.message === "string" ? e.message : undefined;
  };
  const disabled = !canManage;

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-5" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Discount</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Code"
              htmlFor="c-code"
              required
              error={err("code")}
              hint={locked ? "This code has been used, so it can't be renamed." : "Letters, numbers, - and _. Shown in capitals."}
            >
              <Input id="c-code" {...register("code")} disabled={disabled || locked} className="font-mono uppercase" autoComplete="off" aria-invalid={Boolean(err("code"))} />
            </Field>
            <Field label="Type" htmlFor="c-kind" required>
              <Controller
                control={control}
                name="kind"
                render={({ field }) => (
                  <Select
                    id="c-kind"
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={disabled}
                    options={[
                      { value: "percent", label: "Percentage off" },
                      { value: "fixed", label: "Fixed amount off" },
                      { value: "free_shipping", label: "Free shipping" },
                    ]}
                  />
                )}
              />
            </Field>
            {kind === "percent" ? (
              <Field label="Percentage off (%)" htmlFor="c-percent" required error={err("percent")} hint="Up to two decimals, 100 at most.">
                <Input id="c-percent" inputMode="decimal" {...register("percent")} disabled={disabled} className="tabular" aria-invalid={Boolean(err("percent"))} />
              </Field>
            ) : null}
            {kind === "fixed" ? (
              <Field label="Amount off (₹)" htmlFor="c-amount" required error={err("amount")}>
                <Input id="c-amount" inputMode="decimal" {...register("amount")} disabled={disabled} className="tabular" aria-invalid={Boolean(err("amount"))} />
              </Field>
            ) : null}
            {kind === "free_shipping" ? (
              <p className="self-end pb-2 text-[13px] text-admin-ink-muted">Waives the shipping fee. Cash-on-delivery fees still apply.</p>
            ) : null}
            <Field label="Minimum cart value (₹)" htmlFor="c-min" error={err("minSubtotal")} hint="Of the whole cart, before the discount. Blank = no minimum.">
              <Input id="c-min" inputMode="decimal" {...register("minSubtotal")} disabled={disabled} className="tabular" aria-invalid={Boolean(err("minSubtotal"))} />
            </Field>
            {kind !== "free_shipping" ? (
              <Field label="Maximum discount (₹)" htmlFor="c-max" error={err("maxDiscount")} hint="Caps the discount. Blank = no cap.">
                <Input id="c-max" inputMode="decimal" {...register("maxDiscount")} disabled={disabled} className="tabular" aria-invalid={Boolean(err("maxDiscount"))} />
              </Field>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dates and limits</CardTitle>
            <CardDescription>Times are India time (IST). Both ends are inclusive.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor="c-start" error={err("startsAt")} hint="Blank = already started.">
              <Input id="c-start" type="datetime-local" {...register("startsAt")} disabled={disabled} aria-invalid={Boolean(err("startsAt"))} />
            </Field>
            <Field label="Ends" htmlFor="c-end" error={err("endsAt")} hint="Blank = never ends.">
              <Input id="c-end" type="datetime-local" {...register("endsAt")} disabled={disabled} aria-invalid={Boolean(err("endsAt"))} />
            </Field>
            <Field label="Total uses" htmlFor="c-usage" error={err("usageLimit")} hint="Across all customers. Blank = unlimited.">
              <Input id="c-usage" inputMode="numeric" {...register("usageLimit")} disabled={disabled} className="tabular" aria-invalid={Boolean(err("usageLimit"))} />
            </Field>
            <Field label="Uses per customer" htmlFor="c-per" error={err("perCustomerLimit")} hint="Counted by e-mail. Blank = unlimited.">
              <Input id="c-per" inputMode="numeric" {...register("perCustomerLimit")} disabled={disabled} className="tabular" aria-invalid={Boolean(err("perCustomerLimit"))} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What it applies to</CardTitle>
            <CardDescription>
              Leave everything empty for the whole store. A line qualifies if it matches any vibe, type or product chosen,
              unless it is excluded.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <Controller
              control={control}
              name="vibes"
              render={({ field }) => (
                <CheckList legend="Vibes" options={options.vibes.map((v) => ({ value: v.slug, label: v.name }))} value={field.value} onChange={field.onChange} error={err("vibes")} />
              )}
            />
            <Controller
              control={control}
              name="types"
              render={({ field }) => (
                <CheckList legend="Product types" options={options.types.map((v) => ({ value: v.slug, label: v.name }))} value={field.value} onChange={field.onChange} error={err("types")} />
              )}
            />
            <Controller
              control={control}
              name="products"
              render={({ field }) => (
                <CheckList legend="Only these products" options={options.products.map((v) => ({ value: v.id, label: v.name }))} value={field.value} onChange={field.onChange} error={err("products")} />
              )}
            />
            <Controller
              control={control}
              name="excludeProducts"
              render={({ field }) => (
                <CheckList legend="Never these products" options={options.products.map((v) => ({ value: v.id, label: v.name }))} value={field.value} onChange={field.onChange} error={err("excludeProducts")} />
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
            <Controller
              control={control}
              name="active"
              render={({ field }) => (
                <Field label="Active" htmlFor="c-active" inline hint="One coupon per order; it can't be combined with another code.">
                  <Switch id="c-active" checked={field.value} onCheckedChange={field.onChange} disabled={disabled} />
                </Field>
              )}
            />
            <div className="flex items-center gap-3">
              {formError ? (
                <p role="alert" className="text-xs text-admin-danger">
                  {formError}
                </p>
              ) : null}
              {canManage ? (
                <Button type="submit" loading={pending}>
                  <Save aria-hidden /> {couponId ? "Save changes" : "Create coupon"}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}
