"use client";

import { Check } from "lucide-react";
import * as CheckboxPrimitive from "radix-ui/checkbox";
import * as React from "react";

import { cn } from "./cn";

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer flex size-[1.125rem] shrink-0 items-center justify-center rounded-[5px] border border-admin-border-strong bg-admin-surface shadow-xs transition-[background-color,border-color,transform] active:scale-90 hover:border-admin-ink-faint disabled:opacity-50 data-[state=checked]:border-admin-primary data-[state=checked]:bg-admin-primary data-[state=checked]:bg-[image:var(--admin-grad-strong)] data-[state=checked]:text-admin-on-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3" strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
