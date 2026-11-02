import { cva, type VariantProps } from "class-variance-authority";

/**
 * Disabled solid buttons (primary, secondary) read as plainly inactive in every vibe: a flat neutral wash (8% ink on the
 * surface, so it is never the vibe's bright accent or mint), muted text (>= 4.5:1), no glow. Ghost and link just fade.
 */
export const DISABLED_SOLID =
  "disabled:bg-[color-mix(in_srgb,var(--ink)_8%,var(--surface))] disabled:text-ink-muted disabled:shadow-none disabled:brightness-100";

/**
 * Shared look of buttons and icon buttons. Soft by design: no outlines, surface tints and a glow instead. Colour, radius, shadow and motion come from vibe
 * tokens only; every size keeps a >= 44px touch target.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 select-none align-middle",
    "font-semibold leading-none whitespace-nowrap",
    "transition-[transform,box-shadow,background-color,color,filter] ease-vibe",
    "disabled:pointer-events-none",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    "active:translate-y-px",
  ],
  {
    variants: {
      variant: {
        primary:
          "rounded-button bg-accent text-on-accent shadow-button hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 " + DISABLED_SOLID,
        secondary:
          "rounded-button bg-surface-2 text-ink hover:-translate-y-px hover:bg-[color-mix(in_srgb,var(--surface-2),var(--ink)_9%)] active:translate-y-0 " + DISABLED_SOLID,
        ghost: "rounded-button bg-transparent text-ink hover:bg-surface-2 disabled:opacity-50",
        link: "rounded-input px-1 text-link underline underline-offset-4 hover:no-underline disabled:opacity-50",
      },
      size: {
        sm: "min-h-11 px-4 text-sm",
        md: "min-h-12 px-6 text-base",
        lg: "min-h-14 px-8 text-lg",
      },
      fullWidth: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", fullWidth: false },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

