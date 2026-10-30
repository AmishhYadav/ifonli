import { cva, type VariantProps } from "class-variance-authority";
import type { ElementType, HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const cardVariants = cva("rounded-card border-token bg-surface text-ink shadow-card", {
  variants: {
    padding: { none: "", sm: "p-3", md: "p-4 sm:p-5", lg: "p-6 sm:p-8" },
    tone: { surface: "bg-surface", muted: "bg-surface-2" },
  },
  defaultVariants: { padding: "md", tone: "surface" },
});

export interface CardProps extends HTMLAttributes<HTMLElement>, VariantProps<typeof cardVariants> {
  as?: ElementType;
}

export function Card({ as, padding, tone, className, ...rest }: CardProps) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={cn(cardVariants({ padding, tone }), className)} {...rest} />;
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-3 flex flex-col gap-1", className)} {...rest} />;
}

export function CardTitle({
  as,
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" | "h4" | "p" }) {
  const Tag = as ?? "h3";
  return <Tag className={cn("font-display text-xl leading-tight", className)} {...rest} />;
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-3 text-base", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex flex-wrap items-center gap-3", className)} {...rest} />;
}
