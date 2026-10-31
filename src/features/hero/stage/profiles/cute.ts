import type { MotionProfile } from "./types";

/** Cute: bouncy. Back and elastic eases, springy pops, soft curved connectors. */
export const cute: MotionProfile = {
  vibe: "cute",
  summary: "Bouncy: back.out and elastic landings, curved connectors",
  ease: {
    move: "back.out(1.5)",
    settle: "elastic.out(1, 0.6)",
    snap: "back.out(2.2)",
    pop: "elastic.out(1, 0.45)",
    flip: "back.inOut(1.3)",
  },
  stagger: 0.016,
  detour: 0,
  wobble: { amp: 0, hz: 0 },
  flicker: { amp: 0, hz: 0 },
  connector: "curve",
  veilDark: "ink",
  darkLevel: 0.55,
  throughBlack: false,
  burstCount: 10,
};
