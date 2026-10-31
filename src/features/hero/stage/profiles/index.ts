import type { Vibe } from "@/features/vibe/config";

import { bold } from "./bold";
import { cute } from "./cute";
import { funky } from "./funky";
import { gothic } from "./gothic";
import { overthinking } from "./overthinking";
import type { MotionProfile } from "./types";

export type { ConnectorStyle, MotionProfile } from "./types";

export const PROFILES: Record<Vibe, MotionProfile> = { cute, bold, overthinking, gothic, funky };

export function profileFor(vibe: Vibe): MotionProfile {
  return PROFILES[vibe];
}
