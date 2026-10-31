import type { Vibe } from "@/features/vibe/config";

import type { EaseSpec } from "../eases";

export type ConnectorStyle = "curve" | "blocky" | "scribble" | "thin" | "wave";

/**
 * A motion profile: the personality of one vibe, applied to the shared scene modules (plan section 9).
 * Colours are never here: everything is painted with the active vibe's tokens (decision C-05).
 */
export interface MotionProfile {
  vibe: Vibe;
  /** One line for the storyboard and docs. */
  summary: string;
  ease: {
    /** Gliding moves. */
    move: EaseSpec;
    /** Landing / arriving. */
    settle: EaseSpec;
    /** Formation snaps (cross, checkerboard, strip). */
    snap: EaseSpec;
    /** Scale pops (handles, badge, silhouettes). */
    pop: EaseSpec;
    /** Rotations and page flips. */
    flip: EaseSpec;
  };
  /** Seconds between neighbouring tiles in a staggered move. */
  stagger: number;
  /** Detour while moving: an arc as a fraction of tile size (Funky wave paths). 0 = straight. */
  detour: number;
  /** Continuous image wobble in degrees and oscillations per second (Funky). 0 = none. */
  wobble: { amp: number; hz: number };
  /** Candle flicker of the glow layer: opacity amplitude (kept under 0.1) and rate in Hz (kept under 3). */
  flicker: { amp: number; hz: number };
  connector: ConnectorStyle;
  /** Which token is the "dark" of the dark turn: `ink` on light vibes, `bg` on Gothic. */
  veilDark: "ink" | "bg";
  /** Opacity the dark veil reaches in scene 4. */
  darkLevel: number;
  /** The dark veil stays fully opaque until the solid colour has covered it (Gothic fades through black). */
  throughBlack: boolean;
  /** How many silhouettes burst in scene 8. */
  burstCount: number;
}
