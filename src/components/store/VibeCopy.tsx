import type { ElementType } from "react";

import { DEFAULT_VIBE, type Vibe } from "@/features/vibe/config";
import type { CopyKey } from "@/features/vibe/copy";
import { VibeText } from "@/features/vibe/VibeText";
import { getVibeSettings } from "@/server/cache/settings";

interface Props {
  k: CopyKey;
  as?: ElementType;
  className?: string;
}

/**
 * `VibeText` fed with the cached `vibe_cycle` / `default_vibe` settings (the default vibe's variant comes
 * first in the DOM). Falls back to the built-in order if settings cannot be read.
 */
export async function VibeCopy({ k, as, className }: Props) {
  let cycle: Vibe[] | undefined;
  let defaultVibe: Vibe = DEFAULT_VIBE;
  try {
    const settings = await getVibeSettings();
    cycle = settings.cycle;
    if (settings.defaultVibe !== "random") defaultVibe = settings.defaultVibe;
  } catch {
    // keep built-in defaults
  }
  return <VibeText k={k} as={as} className={className} cycle={cycle} defaultVibe={defaultVibe} />;
}
