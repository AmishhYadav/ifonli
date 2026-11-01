"use client";

import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";

import { Icon } from "./Icon";

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Props a control should spread to be wired to its surrounding `Field` (id, description, invalid, required). */
export function useFieldControl() {
  const ctx = useContext(FieldContext);
  return {
    id: ctx?.id,
    "aria-describedby": ctx?.describedBy,
    "aria-invalid": ctx?.invalid ? true : undefined,
    required: ctx?.required || undefined,
  } as const;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Error message. Presence marks the control `aria-invalid` and announces the message politely. */
  error?: ReactNode;
  required?: boolean;
  /** Visually hide the label (it stays for assistive tech). */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint + error. The control inside reads its wiring from context (Input, Textarea, Select...). */
export function Field({ label, hint, error, required, hideLabel, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <FieldContext
      value={{
        id,
        describedBy: describedBy || undefined,
        invalid: Boolean(error),
        required: Boolean(required),
      }}
    >
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className={cn("text-sm font-semibold text-ink", hideLabel && "sr-only")}>
          {label}
          {required ? <span className="ml-1 font-normal text-ink-muted">(required)</span> : null}
        </label>
        {children}
        {hint ? (
          <p id={hintId} className="text-sm text-ink-muted">
            {hint}
          </p>
        ) : null}
        <div aria-live="polite">
          {error ? (
            <p id={errorId} className="flex items-start gap-1.5 text-sm font-semibold text-danger">
              <Icon name="alert-circle" className="mt-0.5 size-4" />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
      </div>
    </FieldContext>
  );
}

const controlClasses = [
  "ui-control w-full min-h-11 rounded-input border-token bg-surface px-4 py-2.5 text-base text-ink",
  "placeholder:text-ink-muted",
  "transition-[box-shadow,border-color] ease-vibe",
  "aria-[invalid=true]:border-danger",
  "disabled:cursor-not-allowed disabled:opacity-60",
].join(" ");

/** Explicit props win over context; `undefined` must not clobber the Field wiring. */
function defined<T extends object>(props: T): Partial<T> {
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

export function Input({ className, ref, ...rest }: InputProps) {
  const field = useFieldControl();
  return <input ref={ref} {...field} {...defined(rest)} className={cn(controlClasses, className)} />;
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, rows = 4, ref, ...rest }: TextareaProps) {
  const field = useFieldControl();
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...field}
      {...defined(rest)}
      className={cn(controlClasses, "min-h-24 resize-y", className)}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ref?: Ref<HTMLSelectElement>;
  wrapperClassName?: string;
}

/** Styled native `<select>`: the platform picker keeps keyboard and mobile behaviour for free. */
export function Select({ className, wrapperClassName, children, ref, ...rest }: SelectProps) {
  const field = useFieldControl();
  return (
    <span className={cn("relative block", wrapperClassName)}>
      <select
        ref={ref}
        {...field}
        {...defined(rest)}
        className={cn("ui-select", controlClasses, "pr-11", className)}
      >
        {children}
      </select>
      <Icon
        name="chevron-down"
        className="pointer-events-none absolute top-1/2 right-3.5 size-5 -translate-y-1/2 text-ink"
      />
    </span>
  );
}
