"use client";

import * as TabsPrimitive from "radix-ui/tabs";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export function Tabs({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn("flex flex-col gap-4", className)} {...rest} />;
}

export function TabsList({ className, ...rest }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex max-w-full gap-1 self-start overflow-x-auto rounded-button bg-surface-2 p-1",
        className,
      )}
      {...rest}
    />
  );
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-button px-4 text-sm font-semibold whitespace-nowrap text-ink transition-[background-color,color,box-shadow] ease-vibe",
        "hover:bg-surface data-[state=active]:bg-accent data-[state=active]:text-on-accent data-[state=active]:shadow-button",
        className,
      )}
      {...rest}
    />
  );
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("text-base text-ink", className)} {...rest} />;
}
