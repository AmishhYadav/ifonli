import type { SVGProps } from "react";

import { cn } from "@/lib/cn";

/** Indeterminate spinner. Decorative: announce progress with `aria-busy` / a status region on the parent. */
export function Spinner({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className={cn("ui-spin size-5 flex-none", className)}
      {...rest}
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
