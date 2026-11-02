import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

import { ProductCardSkeleton } from "./ProductCardView";

/**
 * Responsive grid (2 / 3 / 4 columns). `ProductCard`'s default `sizes` matches these breakpoints; pass your own
 * `sizes` if you change the columns or place the grid inside a narrower container.
 */
export function ProductGrid({ className, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4",
        className,
      )}
      {...rest}
    />
  );
}

/** One grid cell (`li`) so the list keeps list semantics. */
export function ProductGridItem({ className, ...rest }: HTMLAttributes<HTMLLIElement>) {
  return <li className={cn("min-w-0", className)} {...rest} />;
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ProductGrid aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <ProductGridItem key={i}>
          <ProductCardSkeleton />
        </ProductGridItem>
      ))}
    </ProductGrid>
  );
}
