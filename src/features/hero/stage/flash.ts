/**
 * Flash-rate guard (WCAG 2.3.1, three flashes or fewer in any one second; plan section 9).
 *
 * The scenes build their large-area luminance changes (dark turn, solid colour, profile dissolves) from the
 * constants below, and `checkFlashSafety` proves for every motion profile that:
 *   - no luminance change is faster than 200 ms (cross-dissolves only, never a hard cut);
 *   - no more than four luminance transitions start in any one second (a flash is a pair of opposing
 *     transitions, so that is at most two flashes against the limit of three), counting the loop wrap and
 *     the worst case of a profile switch at every boundary the spacing rule allows;
 *   - the Gothic candle flicker stays under a 10 percent opacity swing and 3 Hz.
 */
import {
  BOUNDARIES,
  LOOP_DURATION,
  MIN_DISSOLVE,
  MIN_SWITCH_SPACING,
  PROFILE_FADE,
  sceneStart,
} from "./schedule";
import type { MotionProfile } from "./profiles/types";

export interface LuminanceEvent {
  label: string;
  /** Loop time in seconds when the change starts. */
  at: number;
  duration: number;
  /** Absolute change in the layer's opacity (0..1). */
  delta: number;
}

/** Scene-local timings of the large luminance changes. The scene modules read these same numbers. */
export const LUMI = {
  /** Scene 4: the stage goes dark. */
  darkIn: { scene: 4, at: 0.05, duration: 0.4 },
  /** Scene 5: dark cross-dissolves to the solid vibe colour. */
  toColour: { scene: 5, at: 0.6, duration: 0.4 },
  /** Scene 6: the solid colour dissolves away. */
  colourOut: { scene: 6, at: 0.25, duration: 0.35 },
} as const;

/** Per-tile highlight pulse in scene 9 (small area): up and down, each under the sliding-window rule on its own. */
export const WAVE_PULSE = { up: 0.12, down: 0.28 } as const;

/** Transitions allowed to start in one second: two flashes, under the WCAG limit of three. */
export const MAX_TRANSITIONS_PER_SECOND = 4;

/** Largest allowed flicker opacity swing and rate. */
export const MAX_FLICKER_AMP = 0.1;
export const MAX_FLICKER_HZ = 3;

export function luminanceEvents(profile: MotionProfile): LuminanceEvent[] {
  const abs = (s: { scene: number; at: number }) => sceneStart(s.scene) + s.at;
  return [
    {
      label: "dark-in",
      at: abs(LUMI.darkIn),
      duration: LUMI.darkIn.duration,
      delta: profile.darkLevel,
    },
    { label: "to-colour", at: abs(LUMI.toColour), duration: LUMI.toColour.duration, delta: 0.5 },
    { label: "colour-out", at: abs(LUMI.colourOut), duration: LUMI.colourOut.duration, delta: 0.5 },
  ];
}

/**
 * Greedy worst case of profile switches: one at every boundary that the spacing rule allows, each adding
 * a fade-out ending at the boundary and a fade-in starting at it.
 */
export function worstCaseSwitchEvents(): LuminanceEvent[] {
  const events: LuminanceEvent[] = [];
  let last = -Infinity;
  for (const b of BOUNDARIES) {
    if (b - last < MIN_SWITCH_SPACING - 1e-9 || b - PROFILE_FADE < 0) continue;
    // The wrap boundary is the loop end: its fade-in lands at the start of the next loop.
    events.push({
      label: `switch-out@${b}`,
      at: b - PROFILE_FADE,
      duration: PROFILE_FADE,
      delta: 0.5,
    });
    events.push({ label: `switch-in@${b}`, at: b, duration: PROFILE_FADE, delta: 0.5 });
    last = b;
  }
  return events;
}

/** Most transitions that start inside any window of `windowSec` seconds, counting the wrap-around. */
export function maxStartsInWindow(
  events: readonly LuminanceEvent[],
  windowSec = 1,
  loop: number = LOOP_DURATION,
): number {
  const starts = events.flatMap((e) => [e.at, e.at + loop, e.at - loop]).sort((a, b) => a - b);
  let max = 0;
  for (const s of starts) {
    if (s < 0 || s >= loop) continue;
    const count = starts.filter((x) => x >= s - 1e-9 && x < s + windowSec - 1e-9).length;
    max = Math.max(max, count);
  }
  return max;
}

/** Violations in a set of luminance events: dissolves under 200 ms, or too many transitions in one second. */
export function checkEvents(tag: string, events: readonly LuminanceEvent[]): string[] {
  const problems: string[] = [];
  for (const e of events) {
    if (e.duration < MIN_DISSOLVE - 1e-9) {
      problems.push(`${tag}: ${e.label} dissolves in ${e.duration}s (< ${MIN_DISSOLVE}s)`);
    }
  }
  const worst = maxStartsInWindow(events);
  if (worst > MAX_TRANSITIONS_PER_SECOND) {
    problems.push(`${tag}: ${worst} luminance transitions start within one second`);
  }
  return problems;
}

/** Violations (empty = safe) for one motion profile. */
export function checkFlashSafety(profile: MotionProfile): string[] {
  const problems = checkEvents(profile.vibe, [
    ...luminanceEvents(profile),
    ...worstCaseSwitchEvents(),
  ]);
  if (profile.flicker.amp >= MAX_FLICKER_AMP) {
    problems.push(
      `${profile.vibe}: flicker swing ${profile.flicker.amp} is not under ${MAX_FLICKER_AMP}`,
    );
  }
  if (profile.flicker.hz > MAX_FLICKER_HZ) {
    problems.push(
      `${profile.vibe}: flicker rate ${profile.flicker.hz} Hz is over ${MAX_FLICKER_HZ} Hz`,
    );
  }
  if (profile.darkLevel < 0 || profile.darkLevel > 1)
    problems.push(`${profile.vibe}: darkLevel out of range`);
  return problems;
}
