import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-button px-3 py-0.5 text-xs leading-5 font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-ink",
        accent: "bg-accent text-on-accent",
        success: "bg-[color-mix(in_srgb,var(--success)_10%,var(--surface))] text-success",
        warning: "bg-[color-mix(in_srgb,var(--warning)_10%,var(--surface))] text-warning",
        danger: "bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface))] text-danger",
        sale: "bg-[color-mix(in_srgb,var(--sale)_10%,var(--surface))] text-[color-mix(in_srgb,var(--sale),var(--ink)_25%)]",
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
