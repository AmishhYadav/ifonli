import * as React from "react";

import { cn } from "./cn";

export const inputClasses =
  "flex h-9 w-full items-center rounded-md border border-admin-border-strong bg-admin-surface px-3 text-sm text-admin-ink shadow-xs transition-colors placeholder:text-admin-ink-faint hover:border-admin-ink-faint focus-visible:border-admin-ring focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-admin-ring disabled:cursor-not-allowed disabled:bg-admin-surface-2 disabled:opacity-70 aria-invalid:border-admin-danger aria-invalid:outline-admin-danger";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(inputClasses, className)} {...props} />;
}
