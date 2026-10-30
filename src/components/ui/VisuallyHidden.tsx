import type { ComponentPropsWithoutRef, ElementType } from "react";

type Props<T extends ElementType> = { as?: T } & Omit<ComponentPropsWithoutRef<T>, "as">;

/** Content for assistive tech only (still in the accessibility tree and focus order if focusable). */
export function VisuallyHidden<T extends ElementType = "span">({ as, className, ...rest }: Props<T>) {
  const Tag = (as ?? "span") as ElementType;
  return <Tag className={["sr-only", className].filter(Boolean).join(" ")} {...rest} />;
}
