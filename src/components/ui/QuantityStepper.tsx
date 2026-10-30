"use client";

import { useId, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

import { Icon } from "./Icon";

export interface QuantityStepperProps {
  /** Controlled value. */
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  /** Accessible name of the group and spinbutton. */
  label?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * `-` / value / `+`. Buttons are 44px; the value is a `spinbutton` (ArrowUp/Down, PageUp/Down, Home/End,
 * typing then Enter/blur). Limits use `aria-disabled` so focus is never lost at min/max. Changes are announced
 * through a polite status region.
 */
export function QuantityStepper({
  value,
  defaultValue = 1,
  onChange,
  min = 1,
  max = 10,
  label = "Quantity",
  name,
  disabled = false,
  className,
}: QuantityStepperProps) {
  const id = useId();
  const [inner, setInner] = useState(() => clamp(defaultValue, min, max));
  const current = clamp(value ?? inner, min, max);
  const [draft, setDraft] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const commit = (next: number) => {
    const n = clamp(Math.round(next), min, max);
    if (value === undefined) setInner(n);
    if (n !== current) {
      onChange?.(n);
      setAnnouncement(`${label} ${n}${n === max ? ", maximum" : n === min ? ", minimum" : ""}`);
    }
    setDraft(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const steps: Record<string, number | undefined> = {
      ArrowUp: current + 1,
      ArrowDown: current - 1,
      PageUp: current + 5,
      PageDown: current - 5,
      Home: min,
      End: max,
    };
    const target = steps[event.key];
    if (target !== undefined) {
      event.preventDefault();
      commit(target);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(draft !== null && draft !== "" ? Number(draft) : current);
    }
  };

  const atMin = current <= min;
  const atMax = current >= max;
  const stepButton =
    "inline-flex size-11 flex-none items-center justify-center text-ink transition-colors ease-vibe hover:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent";

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-button border-token bg-surface text-ink",
        disabled && "opacity-60",
        className,
      )}
    >
      <button
        type="button"
        className={stepButton}
        aria-label={`Decrease ${label.toLowerCase()}`}
        aria-controls={id}
        aria-disabled={atMin || disabled || undefined}
        onClick={() => !atMin && !disabled && commit(current - 1)}
      >
        <Icon name="minus" />
      </button>
      <input
        id={id}
        name={name}
        role="spinbutton"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={current}
        disabled={disabled}
        value={draft ?? String(current)}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => draft !== null && commit(draft === "" ? current : Number(draft))}
        onKeyDown={onKeyDown}
        className="h-11 w-12 min-w-0 border-x border-border bg-transparent text-center text-base font-semibold tabular-nums"
      />
      <button
        type="button"
        className={stepButton}
        aria-label={`Increase ${label.toLowerCase()}`}
        aria-controls={id}
        aria-disabled={atMax || disabled || undefined}
        onClick={() => !atMax && !disabled && commit(current + 1)}
      >
        <Icon name="plus" />
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
