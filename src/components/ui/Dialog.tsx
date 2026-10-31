"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

import { IconButton } from "./Button";
import { useFocusReturn } from "./focus-return";
import { ScopeProvider, useOverlayScope } from "./ScopeSentinel";

/** Modal dialog root. Also records the surrounding vibe / Buy scope so the portalled content keeps it. */
export function Dialog({ children, ...rest }: ComponentProps<typeof DialogPrimitive.Root>) {
  return (
    <ScopeProvider>
      <DialogPrimitive.Root {...rest}>{children}</DialogPrimitive.Root>
    </ScopeProvider>
  );
}

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps
  extends Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  /** Required: the dialog's accessible name. */
  title: ReactNode;
  description?: ReactNode;
  /** Keep the title for assistive tech only. */
  hideTitle?: boolean;
  /** Footer row (buttons). */
  footer?: ReactNode;
  closeLabel?: string;
  /** Hide the corner close button (provide your own `DialogClose`). */
  hideClose?: boolean;
}

/**
 * Focus is trapped and returned to the trigger on close, Escape closes, the page behind is inert and
 * scroll-locked (all Radix). Motion follows `--motion-ease` / `--motion-dur`.
 */
export function DialogContent({
  title,
  description,
  hideTitle,
  footer,
  closeLabel = "Close",
  hideClose,
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...rest
}: DialogContentProps) {
  const scope = useOverlayScope();
  const focus = useFocusReturn(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-overlay" />
      <DialogPrimitive.Content
        {...scope}
        {...focus}
        {...(description ? {} : { "aria-describedby": rest["aria-describedby"] })}
        className={cn(
          "ui-dialog flex max-h-[min(85dvh,44rem)] w-[calc(100vw-2rem)] max-w-lg flex-col rounded-card border-token bg-surface text-ink shadow-card",
          className,
        )}
        {...rest}
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogPrimitive.Title
              className={cn("font-display text-2xl leading-tight", hideTitle && "sr-only")}
            >
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-base text-ink-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close asChild>
              <IconButton icon="close" label={closeLabel} size="sm" className="-mt-1 -mr-2" />
            </DialogPrimitive.Close>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2 text-base">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-3 p-5 pt-3">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
