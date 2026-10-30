"use client";

import { get, useController, useFormContext, type FieldValues, type Path } from "react-hook-form";
import * as React from "react";

import { Checkbox } from "./checkbox";
import { cn } from "./cn";
import { Input } from "./input";
import { Label } from "./label";
import { Select, type SelectOption } from "./select";
import { Switch } from "./switch";
import { Textarea } from "./textarea";

export { FormProvider as Form } from "react-hook-form";

/** Label + control + hint + error, wired with aria attributes through `htmlFor` / `describedBy` ids. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
  inline,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
  /** Label to the right of the control (switch / checkbox rows). */
  inline?: boolean;
}) {
  return (
    <div
      className={cn("flex flex-col gap-1.5", inline && "flex-row items-center gap-2.5", className)}
    >
      {inline ? children : null}
      {label ? (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-admin-danger">*</span> : null}
        </Label>
      ) : null}
      {inline ? null : children}
      {hint && !error ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-xs text-admin-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          role="alert"
          className="text-xs text-admin-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The message for a (possibly nested, dotted) field name from the form context. */
export function useFieldError<T extends FieldValues>(name: Path<T>): string | undefined {
  const { formState } = useFormContext<T>();
  const err = get(formState.errors, name) as { message?: unknown } | undefined;
  return typeof err?.message === "string" ? err.message : undefined;
}

interface BaseFieldProps<T extends FieldValues> {
  name: Path<T>;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
}

type TextFieldProps<T extends FieldValues> = BaseFieldProps<T> &
  Omit<React.ComponentProps<typeof Input>, "name">;

export function TextField<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  className,
  id,
  ...inputProps
}: TextFieldProps<T>) {
  const { register } = useFormContext<T>();
  const error = useFieldError<T>(name);
  const fieldId = id ?? `f-${name.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  return (
    <Field
      label={label}
      htmlFor={fieldId}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <Input
        id={fieldId}
        aria-invalid={!!error}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...register(name)}
        {...inputProps}
      />
    </Field>
  );
}

type TextAreaFieldProps<T extends FieldValues> = BaseFieldProps<T> &
  Omit<React.ComponentProps<typeof Textarea>, "name">;

export function TextAreaField<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  className,
  id,
  ...props
}: TextAreaFieldProps<T>) {
  const { register } = useFormContext<T>();
  const error = useFieldError<T>(name);
  const fieldId = id ?? `f-${name.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  return (
    <Field
      label={label}
      htmlFor={fieldId}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <Textarea
        id={fieldId}
        aria-invalid={!!error}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...register(name)}
        {...props}
      />
    </Field>
  );
}

export function SelectField<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  className,
  options,
  placeholder,
  disabled,
}: BaseFieldProps<T> & {
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const { field } = useController<T>({ name });
  const error = useFieldError<T>(name);
  const fieldId = `f-${name.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  return (
    <Field
      label={label}
      htmlFor={fieldId}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <Select
        id={fieldId}
        value={(field.value as string) ?? ""}
        onValueChange={field.onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={!!error}
      />
    </Field>
  );
}

export function SwitchField<T extends FieldValues>({
  name,
  label,
  hint,
  className,
  disabled,
}: BaseFieldProps<T> & { disabled?: boolean }) {
  const { field } = useController<T>({ name });
  const fieldId = `f-${name.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  return (
    <Field label={label} htmlFor={fieldId} hint={hint} className={className} inline>
      <Switch
        id={fieldId}
        checked={!!field.value}
        onCheckedChange={field.onChange}
        disabled={disabled}
      />
    </Field>
  );
}

export function CheckboxField<T extends FieldValues>({
  name,
  label,
  hint,
  className,
  disabled,
}: BaseFieldProps<T> & { disabled?: boolean }) {
  const { field } = useController<T>({ name });
  const fieldId = `f-${name.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  return (
    <Field label={label} htmlFor={fieldId} hint={hint} className={className} inline>
      <Checkbox
        id={fieldId}
        checked={!!field.value}
        onCheckedChange={(v) => field.onChange(v === true)}
        disabled={disabled}
      />
    </Field>
  );
}
