import type { InputHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "@/lib/cn";

import { Icon } from "./Icon";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> {
  label: ReactNode;
  description?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

/** Native checkbox, restyled from tokens. The whole row (>= 44px) is the click target. */
export function Checkbox({ label, description, className, ref, ...rest }: CheckboxProps) {
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
          type="checkbox"
          className="peer absolute inset-0 m-0 size-full cursor-[inherit] appearance-none rounded-[9px] border-token bg-field shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--ink)_10%,transparent)] transition-colors ease-vibe hover:bg-surface-2 checked:border-accent checked:bg-accent aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_25%,transparent)]"
          {...rest}
        />
        <Icon
          name="check"
          className="pointer-events-none absolute inset-0 m-auto size-4 text-on-accent opacity-0 transition-opacity ease-vibe peer-checked:opacity-100"
        />
      </span>
      <span className="flex flex-col">
        <span className="text-base leading-6 font-medium">{label}</span>
        {description ? <span className="text-sm text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}
