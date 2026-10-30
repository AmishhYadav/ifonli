import type { ElementType } from "react";

import { COPY, type CopyKey } from "./copy";
import { DEFAULT_VIBE, DEFAULT_VIBE_CYCLE, type Vibe } from "./config";

interface Props {
  k: CopyKey;
  /** Wrapper element. The variants inside are `display: contents` spans, so the wrapper owns layout. */
  as?: ElementType;
  className?: string;
  cycle?: readonly Vibe[];
  defaultVibe?: Vibe;
}

/**
 * Renders the copy for ALL vibes; CSS (`[data-v] { display: var(--dv-x) }`) shows only the variant of the
 * nearest `[data-vibe]`. No hydration mismatch, no flash, zero round-trips when the vibe changes.
 * The default vibe's variant is first in the DOM (SEO / no-CSS reading order).
 */
export function VibeText({
  k,
  as,
  className,
  cycle = DEFAULT_VIBE_CYCLE,
  defaultVibe = DEFAULT_VIBE,
}: Props) {
  const Tag = (as ?? "span") as ElementType;
  const ordered = [defaultVibe, ...cycle.filter((v) => v !== defaultVibe)];
  return (
    <Tag className={className}>
      {ordered.map((vibe) => (
        <span key={vibe} data-v={vibe}>
          {COPY[vibe][k]}
        </span>
      ))}
    </Tag>
  );
}
