import type { SVGProps } from "react";

import { cn } from "@/lib/cn";

/** Every symbol in `public/icons/sprite.svg` (without the `i-` prefix). A unit test keeps this in sync. */
export const ICON_NAMES = [
  "search",
  "bag",
  "heart",
  "heart-filled",
  "user",
  "menu",
  "close",
  "plus",
  "minus",
  "chevron-left",
  "chevron-right",
  "chevron-down",
  "chevron-up",
  "arrow-right",
  "arrow-left",
  "check",
  "alert-circle",
  "info",
  "truck",
  "package",
  "lock",
  "shield-check",
  "trash",
  "filter",
  "sort",
  "pause",
  "play",
  "external-link",
  "copy",
  "upload",
  "image",
  "star",
  "sparkle",
  "mail",
  "phone",
  "map-pin",
  "refresh",
  "eye",
  "edit",
  "grid",
  "list",
  "tag",
  "gift",
  "rupee",
  "instagram",
  "whatsapp",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export const SPRITE_URL = "/icons/sprite.svg";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Accessible name. Omit for decorative icons (the default): they are hidden from assistive tech. */
  label?: string;
}

/** Sprite icon. Stroke width, caps, joins and filter come from the active vibe through the `.icon` class. */
export function Icon({ name, label, className, ...rest }: IconProps) {
  return (
    <svg
      className={cn("icon", className)}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
    >
      <use href={`${SPRITE_URL}#i-${name}`} />
    </svg>
  );
}
