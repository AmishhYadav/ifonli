import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as Slot from "radix-ui/slot";
import * as React from "react";

import { cn } from "./cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,transform,filter] duration-150 select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "admin-btn-primary text-admin-on-primary",
        secondary: "bg-admin-primary-soft text-admin-primary hover:bg-admin-surface-2",
        outline:
          "border border-admin-border-strong bg-admin-surface text-admin-ink shadow-xs hover:border-admin-primary/40 hover:bg-admin-primary-soft",
        ghost: "text-admin-ink-muted hover:bg-admin-surface-2 hover:text-admin-ink",
        danger: "bg-admin-danger text-admin-on-primary shadow-sm hover:brightness-110",
        "danger-outline":
          "border border-admin-danger/40 bg-admin-surface text-admin-danger hover:border-admin-danger/70 hover:bg-admin-danger-soft",
        link: "h-auto p-0 text-admin-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-4",
        lg: "h-11 px-5 text-[15px]",
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
