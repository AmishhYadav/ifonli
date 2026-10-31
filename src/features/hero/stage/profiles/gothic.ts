import type { MotionProfile } from "./types";

/** Gothic: slow sine glides, everything fades through black, the glow layer flickers like a candle. */
export const gothic: MotionProfile = {
  vibe: "gothic",
  summary: "Slow sine, fade-through-black, candle flicker",
  ease: {
    move: "sine.inOut",
    settle: "sine.out",
    snap: "sine.inOut",
    pop: "sine.out",
    flip: "sine.inOut",
  },
  stagger: 0.028,
  detour: 0,
  wobble: { amp: 0, hz: 0 },
  // An opacity swing well under the 10 percent general-flash threshold, at under 3 Hz.
  flicker: { amp: 0.07, hz: 2 },
  connector: "thin",
  veilDark: "bg",
  darkLevel: 1,
  throughBlack: true,
  burstCount: 7,
};
