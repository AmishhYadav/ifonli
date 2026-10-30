"use client";

import {
  createContext,
  useContext,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

import { cn } from "@/lib/cn";

interface RadioGroupContextValue {
  name: string;
  value: string | undefined;
  onChange: (value: string) => void;
  disabled: boolean;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps {
  legend: ReactNode;
  /** Shared `name` of the radios (defaults to a generated one). */
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  hideLegend?: boolean;
  orientation?: "vertical" | "horizontal";
  className?: string;
  children: ReactNode;
}

/** `fieldset` + `legend` around native radios: arrow keys, roving focus and form posting all work natively. */
export function RadioGroup({
  legend,
  name,
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  hideLegend,
  orientation = "vertical",
  className,
  children,
}: RadioGroupProps) {
  const generated = useId();
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;

  return (
    <RadioGroupContext
      value={{
        name: name ?? generated,
        value: current,
        disabled,
        onChange: (next) => {
          if (value === undefined) setInner(next);
          onValueChange?.(next);
        },
      }}
    >
      <fieldset className={cn("min-w-0 border-0 p-0", className)} disabled={disabled}>
        <legend className={cn("mb-1 p-0 text-sm font-semibold text-ink", hideLegend && "sr-only")}>
          {legend}
        </legend>
        <div className={cn("flex gap-x-6", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap")}>
          {children}
        </div>
      </fieldset>
    </RadioGroupContext>
  );
}

export interface RadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children" | "value" | "name"> {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function Radio({ value, label, description, className, onChange, ref, ...rest }: RadioProps) {
  const group = useContext(RadioGroupContext);
  const groupProps = group
    ? {
        name: group.name,
        checked: group.value === value,
        onChange: (event: Parameters<NonNullable<typeof onChange>>[0]) => {
          group.onChange(value);
          onChange?.(event);
        },
      }
    : { onChange };

  return (
    <label
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-start gap-3 py-2 text-ink has-disabled:cursor-not-allowed has-disabled:opacity-60",
        className,
      )}
    >
      <span className="relative mt-px inline-flex size-6 flex-none">
        <input
          ref={ref}
          type="radio"
          value={value}
          className="peer absolute inset-0 m-0 size-full cursor-[inherit] appearance-none rounded-full border-token bg-surface transition-colors ease-vibe checked:border-accent"
          {...groupProps}
          {...rest}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-1.5 scale-0 rounded-full bg-accent transition-transform ease-vibe peer-checked:scale-100"
        />
      </span>
      <span className="flex flex-col">
        <span className="text-base leading-6 font-medium">{label}</span>
        {description ? <span className="text-sm text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}
