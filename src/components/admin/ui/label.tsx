"use client";

import * as LabelPrimitive from "radix-ui/label";
import * as React from "react";

import { cn } from "./cn";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("text-[13px] leading-none font-medium text-admin-ink select-none", className)}
      {...props}
    />
  );
}
