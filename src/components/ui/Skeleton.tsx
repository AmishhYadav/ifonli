import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const skeletonVariants = cva("ui-skeleton block bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]", {
  variants: {
    shape: {
      /** Follows the input radius token. */
      block: "rounded-input",
      /** Follows the card radius token. */
      card: "rounded-card",
      /** One line of text. */
      text: "h-4 w-full rounded-input",
      circle: "aspect-square rounded-full",
    },
  },
  defaultVariants: { shape: "block" },
});

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof skeletonVariants> {}

/** Placeholder block. Size it with classes; its corners come from the radius tokens. Hidden from assistive tech. */
export function Skeleton({ shape, className, ...rest }: SkeletonProps) {
  return <span aria-hidden="true" className={cn(skeletonVariants({ shape }), className)} {...rest} />;
}
