"use client";

import { useCallback, useRef } from "react";

type FocusEventHandler = (event: Event) => void;

/**
 * Radix returns focus on close only to a `<Dialog.Trigger>`. Dialogs and drawers here are often opened
 * from state (an "Add address" button that sets `open`, the header cart link, a toast action), which would
 * drop keyboard users back at the top of the page. This remembers what had focus when the overlay opened
 * and gives it back on close, unless the caller already took over (`event.preventDefault()`) or the element
 * is gone.
 */
export function useFocusReturn(
  onOpenAutoFocus?: FocusEventHandler,
  onCloseAutoFocus?: FocusEventHandler,
): { onOpenAutoFocus: FocusEventHandler; onCloseAutoFocus: FocusEventHandler } {
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback(
    (event: Event) => {
      const active = typeof document === "undefined" ? null : document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onOpenAutoFocus?.(event);
    },
    [onOpenAutoFocus],
  );

  const close = useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      const el = opener.current;
      opener.current = null;
      if (event.defaultPrevented || !el || !el.isConnected) return;
      event.preventDefault();
      el.focus();
    },
    [onCloseAutoFocus],
  );

  return { onOpenAutoFocus: open, onCloseAutoFocus: close };
}
