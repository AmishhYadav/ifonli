import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { VIBE_NAMES, isVibe, type Vibe } from "@/features/vibe/config";
import { cn } from "@/lib/cn";

import { Icon } from "./Icon";

const chipBase =
  "inline-flex items-center gap-1.5 rounded-button px-4 text-sm font-semibold whitespace-nowrap transition-[background-color,box-shadow,transform] ease-vibe";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  /** Toggle state. When `selected` or `onClick` is given the chip is a real `<button aria-pressed>` (44px target). */
  selected?: boolean;
}

/** Filter / tag chip. Static chips render as a `<span>`; interactive ones as a toggle button. */
export function Chip({ selected, onClick, className, children, ...rest }: ChipProps) {
  const interactive = selected !== undefined || onClick !== undefined;
  const look = selected ? "bg-accent text-on-accent shadow-button" : "bg-surface-2 text-ink";
  if (!interactive) {
    return <span className={cn(chipBase, "min-h-8", look, className)}>{children}</span>;
  }
  return (
    <button
      type="button"
      aria-pressed={selected ?? false}
      onClick={onClick}
      className={cn(chipBase, "min-h-11", look, !selected && "hover:-translate-y-px hover:bg-[color-mix(in_srgb,var(--surface-2),var(--ink)_9%)]", className)}
      {...rest}
    >
      {selected ? <Icon name="check" className="size-4" /> : null}
      {children}
    </button>
  );
}

interface VibeChipBaseProps {
  vibe: Vibe;
  /** Defaults to the vibe's name. */
  children?: ReactNode;
  selected?: boolean;
  className?: string;
}

export type VibeChipProps = VibeChipBaseProps &
  (
    | { href: string; onClick?: undefined }
    | { href?: undefined; onClick?: () => void }
  );

/**
 * A chip that always wears ITS vibe: it sets `data-vibe` on itself, so the colours, radius, border, shadow
 * and display font are that vibe's, whatever the page vibe is.
 */
export function VibeChip({ vibe, children, selected, className, href, onClick }: VibeChipProps) {
  const classes = cn(
    "inline-flex min-h-11 items-center gap-1.5 rounded-button bg-accent px-4 text-base text-on-accent font-display",
    "transition-[box-shadow,transform] ease-vibe",
    selected ? "shadow-button" : "hover:-translate-y-0.5",
    className,
  );
  const content = (
    <>
      {selected ? <Icon name="check" className="size-4" /> : null}
      {children ?? VIBE_NAMES[vibe]}
    </>
  );
  if (href !== undefined) {
    return (
      <Link href={href} data-vibe={vibe} className={classes} aria-current={selected ? "true" : undefined}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" data-vibe={vibe} className={classes} aria-pressed={selected ?? false} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <span data-vibe={vibe} className={cn(classes, "min-h-8 text-sm")}>
      {content}
    </span>
  );
}

/** A small round swatch in a vibe's own accent. Decorative; pair it with the vibe's name in text. */
export function VibeDot({ vibe, className }: { vibe: string; className?: string }) {
  if (!isVibe(vibe)) return null;
  return (
    <span
      data-vibe={vibe}
      aria-hidden="true"
      className={cn("inline-block size-3.5 flex-none rounded-full bg-accent", className)}
    />
  );
}
