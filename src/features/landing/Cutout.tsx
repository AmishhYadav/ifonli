import Image from "next/image";
import type { CSSProperties } from "react";

import { cutoutSrc } from "./data";

/** Decorative product art: static SVG, hidden from assistive tech, explicit size so nothing shifts. */
export function Cutout({
  name,
  className,
  style,
  eager = false,
}: {
  name: string;
  className?: string;
  style?: CSSProperties;
  eager?: boolean;
}) {
  return (
    <Image
      src={cutoutSrc(name)}
      alt=""
      aria-hidden="true"
      width={512}
      height={512}
      unoptimized
      draggable={false}
      loading={eager ? "eager" : "lazy"}
      className={className}
      style={style}
    />
  );
}
