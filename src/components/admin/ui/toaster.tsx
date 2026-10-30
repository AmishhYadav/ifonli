"use client";

import { Toaster as Sonner } from "sonner";

/** Toasts for the admin (`import { toast } from "sonner"` to raise one). Mounted once in the admin root layout. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: "!rounded-lg !border !border-admin-border !font-sans !text-sm",
        },
      }}
    />
  );
}
