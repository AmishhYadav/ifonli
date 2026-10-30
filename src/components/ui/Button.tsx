"use client";

import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes, MouseEvent, Ref } from "react";

import { cn } from "@/lib/cn";

import { buttonVariants, type ButtonSize, type ButtonVariant } from "./buttonStyles";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  /** Shows a spinner, sets `aria-busy` and ignores clicks (stays focusable, unlike `disabled`). */
  loading?: boolean;
  /** Render the single child element (e.g. `next/link`) with the button's classes and props. */
  asChild?: boolean;
  /** Icon before the label. */
  iconStart?: IconName;
  /** Icon after the label. */
  iconEnd?: IconName;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  asChild = false,
  iconStart,
  iconEnd,
  className,
  children,
  disabled,
  onClick,
  type,
  ref,
  ...rest
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, fullWidth }), className);

  if (asChild) {
    return (
      <Slot.Root
        ref={ref as Ref<HTMLElement>}
        className={classes}
        aria-busy={loading || undefined}
        aria-disabled={loading || disabled || undefined}
        {...rest}
      >
        {children}
      </Slot.Root>
    );
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading ? <Spinner /> : iconStart ? <Icon name={iconStart} /> : null}
      {children}
      {iconEnd && !loading ? <Icon name={iconEnd} /> : null}
    </button>
  );
}

const iconButtonSize = {
  sm: "min-h-11 min-w-11 p-0",
  md: "min-h-12 min-w-12 p-0",
  lg: "min-h-14 min-w-14 p-0",
} as const;

export interface IconButtonProps
  extends Omit<ButtonProps, "children" | "iconStart" | "iconEnd" | "fullWidth" | "variant" | "asChild"> {
  /** Required accessible name (icon-only buttons have no visible text). */
  label: string;
  icon: IconName;
  variant?: Exclude<ButtonVariant, "link">;
}

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  className,
  loading,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      loading={loading}
      aria-label={label}
      className={cn(iconButtonSize[size], className)}
      {...rest}
    >
      {loading ? null : <Icon name={icon} className="size-6" />}
    </Button>
  );
}
