import type { InputHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "@/lib/cn";

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "children"> {
  label: ReactNode;
  description?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

/** On/off setting: a native checkbox with `role="switch"`, so it works in forms and with every assistive tech. */
export function Switch({ label, description, className, ref, ...rest }: SwitchProps) {
  return (
    <label
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-start gap-3 py-2 text-ink has-disabled:cursor-not-allowed has-disabled:opacity-60",
        className,
      )}
    >
      <span className="relative mt-px inline-flex h-7 w-12 flex-none">
        <input
          ref={ref}
          type="checkbox"
          role="switch"
          className="peer absolute inset-0 z-10 m-0 size-full cursor-[inherit] opacity-0"
          {...rest}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-button border-token bg-surface-2 transition-colors ease-vibe peer-checked:bg-accent peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus-ring"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1 size-5 -translate-y-1/2 rounded-button bg-ink transition-[translate,background-color] ease-vibe peer-checked:translate-x-5 peer-checked:bg-on-accent"
        />
      </span>
      <span className="flex flex-col">
        <span className="text-base leading-6 font-medium">{label}</span>
        {description ? <span className="text-sm text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}
