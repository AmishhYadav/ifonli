import type { ComponentPropsWithoutRef, ElementType } from "react";

import type { Vibe } from "./config";

type Props<T extends ElementType> = {
  vibe: Vibe;
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "data-vibe">;

/** Re-skins its subtree with one vibe's tokens (palette + shape/type/texture), whatever the site vibe is. */
export function VibeScope<T extends ElementType = "div">({ vibe, as, ...rest }: Props<T>) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag data-vibe={vibe} {...rest} />;
}
