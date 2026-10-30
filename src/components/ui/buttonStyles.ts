import { cva, type VariantProps } from "class-variance-authority";

/**
 * Shared look of buttons and icon buttons. Colour, radius, border width, shadow and motion come from vibe
 * tokens only; every size keeps a >= 44px touch target.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 select-none align-middle",
    "font-semibold leading-none whitespace-nowrap",
    "transition-[transform,box-shadow,background-color,color,filter] ease-vibe",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    "active:translate-y-px",
  ],
  {
    variants: {
      variant: {
        primary:
          "rounded-button border-token bg-accent text-on-accent shadow-button hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0",
        secondary:
          "rounded-button border-token bg-surface text-ink shadow-button hover:-translate-y-0.5 hover:bg-surface-2 active:translate-y-0",
        ghost: "rounded-button border border-transparent bg-transparent text-ink hover:bg-surface-2",
        link: "rounded-input px-1 text-link underline underline-offset-4 hover:no-underline",
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

