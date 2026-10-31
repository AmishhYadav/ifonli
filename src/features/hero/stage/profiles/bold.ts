import type { MotionProfile } from "./types";

/** Bold: hard snaps. steps() eases for formations, expo for glides, square-cornered connectors. */
export const bold: MotionProfile = {
  vibe: "bold",
  summary: "Hard snaps: steps() and expo, square-cornered connectors",
  ease: {
    move: "expo.inOut",
    settle: "expo.out",
    snap: "steps(4)",
    pop: "steps(3)",
    flip: "expo.inOut",
  },
  stagger: 0.009,
  detour: 0,
  wobble: { amp: 0, hz: 0 },
  flicker: { amp: 0, hz: 0 },
  connector: "blocky",
  veilDark: "ink",
  darkLevel: 0.9,
  throughBlack: false,
  burstCount: 8,
};
