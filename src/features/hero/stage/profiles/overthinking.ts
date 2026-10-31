import { hesitate } from "../eases";

import type { MotionProfile } from "./types";

/** Overthinking: hesitation. Moves stop to reconsider; connectors are scribbled in (DrawSVG). */
export const overthinking: MotionProfile = {
  vibe: "overthinking",
  summary: "Hesitation pauses mid-move, DrawSVG scribble connectors",
  ease: {
    move: hesitate(0.75),
    settle: hesitate(0.4),
    snap: hesitate(0.5),
    pop: "power2.out",
    flip: hesitate(0.6),
  },
  stagger: 0.024,
  detour: 0,
  wobble: { amp: 0, hz: 0 },
  flicker: { amp: 0, hz: 0 },
  connector: "scribble",
  veilDark: "ink",
  darkLevel: 0.6,
  throughBlack: false,
  burstCount: 9,
};
