"use client";

import * as SwitchPrimitive from "radix-ui/switch";
import * as React from "react";

import { cn } from "./cn";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent bg-admin-border-strong shadow-xs transition-colors duration-200 disabled:opacity-50 data-[state=checked]:bg-admin-primary data-[state=checked]:bg-[image:var(--admin-grad-strong)]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 translate-x-0.5 rounded-full bg-admin-surface shadow-md transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-x-110 data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}
