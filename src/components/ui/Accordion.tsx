"use client";

import * as AccordionPrimitive from "radix-ui/accordion";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

import { Icon } from "./Icon";

/** Disclosure list. Pass `type="single" collapsible` or `type="multiple"` (Radix props). */
export function Accordion({ className, ...rest }: ComponentProps<typeof AccordionPrimitive.Root>) {
  return (
    <AccordionPrimitive.Root
      className={cn("w-full overflow-hidden rounded-card bg-surface text-ink shadow-card", className)}
      {...rest}
    />
  );
}

export function AccordionItem({ className, ...rest }: ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      className={cn("border-b border-hairline last:border-b-0", className)}
      {...rest}
    />
  );
}

export function AccordionTrigger({
  className,
  children,
  ...rest
}: ComponentProps<typeof AccordionPrimitive.Trigger> & { children: ReactNode }) {
  return (
    <AccordionPrimitive.Header className="m-0">
      <AccordionPrimitive.Trigger
        className={cn(
          "group flex min-h-12 w-full items-center justify-between gap-4 px-5 py-3.5 text-left text-base font-semibold text-ink transition-colors ease-vibe hover:bg-surface-2",
          className,
        )}
        {...rest}
      >
        {children}
        <Icon
          name="chevron-down"
          className="size-5 transition-transform ease-vibe group-data-[state=open]:rotate-180"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...rest
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content className="ui-accordion-content" {...rest}>
      <div className={cn("px-5 pt-1 pb-5 text-base text-ink-muted", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
