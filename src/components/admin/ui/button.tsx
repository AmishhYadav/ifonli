import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "./cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-admin-primary text-admin-on-primary shadow-xs hover:bg-admin-primary-hover",
        secondary: "bg-admin-surface-2 text-admin-ink hover:bg-admin-border",
        outline:
          "border border-admin-border-strong bg-admin-surface text-admin-ink shadow-xs hover:bg-admin-surface-2",
        ghost: "text-admin-ink-muted hover:bg-admin-surface-2 hover:text-admin-ink",
        danger: "bg-admin-danger text-admin-on-primary shadow-xs hover:brightness-95",
        "danger-outline":
          "border border-admin-danger/40 bg-admin-surface text-admin-danger hover:bg-admin-danger-soft",
        link: "h-auto p-0 text-admin-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-2.5 text-[13px]",
        md: "h-9 px-3.5",
        lg: "h-10 px-5",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  loading?: boolean;
  /** Render the child element (for example a `Link`) with button styles. */
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  loading,
  disabled,
  children,
  type = "button",
  asChild,
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <Slot.Root
        className={cn(buttonVariants({ variant, size }), className)}
        {...(props as object)}
      >
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
