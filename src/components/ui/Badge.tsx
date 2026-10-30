import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-button px-2.5 py-0.5 text-xs leading-5 font-bold whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-ink",
        accent: "bg-accent text-on-accent",
        success: "border-solid border-(length:--border-w) border-success bg-surface text-success",
        warning: "border-solid border-(length:--border-w) border-warning bg-surface text-warning",
        danger: "border-solid border-(length:--border-w) border-danger bg-surface text-danger",
        sale: "border-solid border-(length:--border-w) border-sale bg-surface text-sale",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

/** Small status label. Not interactive (no 44px target); colour is never the only signal, the text says it. */
export function Badge({ tone, className, ...rest }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...rest} />;
}
