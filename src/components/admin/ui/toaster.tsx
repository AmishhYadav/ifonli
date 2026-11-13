"use client";

import { Toaster as Sonner } from "sonner";

/**
 * Toasts for the admin (`import { toast } from "sonner"` to raise one). Mounted once in the admin root layout.
 * Frosted white cards; the type shows in the icon colour (see the sonner rules in styles/admin.css).
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      theme="light"
      closeButton
      toastOptions={{
        classNames: {
          toast: "!rounded-2xl !border !border-admin-border !font-sans !text-sm",
        },
      }}
    />
  );
}
