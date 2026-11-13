import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "./cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ring-current/15 [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-admin-surface-2 text-admin-ink-muted",
        primary: "bg-admin-primary-soft text-admin-primary",
        success: "bg-admin-success-soft text-admin-success",
        warning: "bg-admin-warning-soft text-admin-warning",
        danger: "bg-admin-danger-soft text-admin-danger",
        info: "bg-admin-info-soft text-admin-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
