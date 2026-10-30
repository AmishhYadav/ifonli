"use client";

import { IconLink } from "./IconLink";

/**
 * Header cart entry. For now it only links to /cart and shows no count.
 * The cart feature replaces this file with the live count and the cart drawer; keep the export name
 * and the `className` prop so the header does not change.
 */
export function CartButton({ className }: { className?: string }) {
  return <IconLink href="/cart" icon="bag" label="Cart" className={className} />;
}
