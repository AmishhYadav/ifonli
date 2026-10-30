"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

import { IconButton } from "./Button";
import { ScopeProvider, useOverlayScope } from "./ScopeSentinel";

/** Slide-in panel (cart drawer, mobile menu, filters). A modal Radix Dialog under the hood. */
export function Drawer({ children, ...rest }: ComponentProps<typeof DialogPrimitive.Root>) {
  return (
    <ScopeProvider>
      <DialogPrimitive.Root {...rest}>{children}</DialogPrimitive.Root>
    </ScopeProvider>
  );
}

export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerContentProps
  extends Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  side?: "right" | "left";
  /** Required: the panel's accessible name. */
  title: ReactNode;
  description?: ReactNode;
  hideTitle?: boolean;
  /** Sticks to the bottom (e.g. the cart's checkout button). */
  footer?: ReactNode;
  closeLabel?: string;
}

/** Focus trap, Escape, labelled title, scroll lock; slides with the vibe's motion tokens (none when reduced motion). */
export function DrawerContent({
  side = "right",
  title,
  description,
  hideTitle,
  footer,
  closeLabel = "Close",
  className,
  children,
  ...rest
}: DrawerContentProps) {
  const scope = useOverlayScope();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-overlay" />
      <DialogPrimitive.Content
        {...scope}
        data-side={side}
        {...(description ? {} : { "aria-describedby": rest["aria-describedby"] })}
        className={cn(
          "ui-drawer flex w-[min(26rem,calc(100vw-2.5rem))] flex-col border-token bg-surface text-ink shadow-card",
          side === "right" ? "border-r-0" : "border-l-0",
          className,
        )}
        {...rest}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogPrimitive.Title
              className={cn("font-display text-2xl leading-tight", hideTitle && "sr-only")}
            >
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-ink-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close asChild>
            <IconButton icon="close" label={closeLabel} size="sm" className="-mt-1 -mr-2" />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-base">{children}</div>
        {footer ? <div className="flex flex-col gap-3 border-t border-border p-4">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
