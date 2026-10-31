import type { MotionProfile } from "./types";

/** Funky: wobble and warp. Wavy detours, wobbling products, 70s wave connectors. */
export const funky: MotionProfile = {
  vibe: "funky",
  summary: "Wobble and warp: wavy detours, wobbling products, 70s wave connectors",
  ease: {
    move: "power2.inOut",
    settle: "elastic.out(1.1, 0.35)",
    snap: "back.out(3)",
    pop: "elastic.out(1.2, 0.3)",
    flip: "power3.inOut",
  },
  stagger: 0.014,
  detour: 0.16,
  wobble: { amp: 7, hz: 1.6 },
  flicker: { amp: 0, hz: 0 },
  connector: "wave",
  veilDark: "ink",
  darkLevel: 0.7,
  throughBlack: false,
  burstCount: 12,
};
