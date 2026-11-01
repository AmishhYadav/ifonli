/** Easing helpers for the motion profiles. Pure functions, no GSAP import (GSAP accepts both strings and functions). */

export type EaseFn = (progress: number) => number;
export type EaseSpec = string | EaseFn;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const smooth = (n: number): number => n * n * (3 - 2 * n);

/**
 * Hesitation easing: the motion starts, stops to reconsider, starts again, then settles.
 * `strength` 0..1 is the share of the duration spent hesitating (0 = a plain smooth ease). Monotone,
 * f(0) = 0 and f(1) = 1, so tiles always arrive exactly where the pose says.
 */
export function hesitate(strength: number): EaseFn {
  const hold = 0.28 * clamp01(strength); // each of the two pauses
  const move = (1 - 2 * hold) / 3; // three equal moves between the pauses
  const stops: readonly [number, number, number, number][] = [
    // [t0, t1, v0, v1]
    [0, move, 0, 0.38],
    [move + hold, 2 * move + hold, 0.38, 0.74],
    [2 * (move + hold), 1, 0.74, 1],
  ];
  return (p) => {
    const t = clamp01(p);
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    for (let i = 0; i < stops.length; i += 1) {
      const [t0, t1, v0, v1] = stops[i]!;
      if (t >= t0 && t <= t1) {
        const span = t1 - t0;
        return span <= 0 ? v1 : v0 + (v1 - v0) * smooth((t - t0) / span);
      }
      const next = stops[i + 1];
      if (next && t > t1 && t < next[0]) return v1; // paused
    }
    return 1;
  };
}

/** A damped wobble that starts and ends at rest: `amp` degrees, `hz` oscillations per second over `duration`. */
export function wobbleAt(timeSec: number, amp: number, hz: number, phase = 0): number {
  return amp * Math.sin(2 * Math.PI * hz * timeSec + phase);
}

/** Deterministic pseudo-random number in [0, 1) from two integers (stable across renders and seeks). */
export function hash01(a: number, b = 0): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Ease used for every luminance change (veils, glow): never stepped, never elastic. */
export const LUMINANCE_EASE = "sine.inOut";
