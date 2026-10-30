"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactElement, ReactNode } from "react";

import { cn } from "@/lib/cn";

import { ScopeProvider, useOverlayScope } from "./ScopeSentinel";

export interface TooltipProps {
  /** Short, supplementary text. Never the only place important information lives (touch has no hover). */
  content: ReactNode;
  /** The trigger element (a single focusable child). */
  children: ReactElement;
  side?: ComponentProps<typeof TooltipPrimitive.Content>["side"];
  delayDuration?: number;
  className?: string;
}

function TooltipBody({ content, side = "top", className }: Pick<TooltipProps, "content" | "side" | "className">) {
  const scope = useOverlayScope();
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        {...scope}
        side={side}
        sideOffset={8}
        collisionPadding={8}
        className={cn(
          "ui-tooltip z-70 max-w-64 rounded-input bg-ink px-3 py-1.5 text-sm font-medium text-bg",
          className,
        )}
      >
        {content}
        <TooltipPrimitive.Arrow className="fill-ink" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/** Opens on hover and keyboard focus, closes on Escape, text is exposed through `aria-describedby`. */
export function Tooltip({ content, children, side, delayDuration = 250, className }: TooltipProps) {
  return (
    <ScopeProvider>
      <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={300}>
        <TooltipPrimitive.Root>
          <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
          <TooltipBody content={content} side={side} className={className} />
        </TooltipPrimitive.Root>
      </TooltipPrimitive.Provider>
    </ScopeProvider>
  );
}
