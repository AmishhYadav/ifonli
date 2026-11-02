/**
 * Hero loop schedule (plan section 9): ten scenes, 12 s. Pure data and arithmetic, no DOM and no GSAP,
 * so scene boundaries, the switch timing constants and the storyboard timestamps are unit-tested.
 */

export interface SceneDef {
  /** 1-based, matches the plan table. */
  id: number;
  name: string;
  /** Seconds. */
  duration: number;
  /** Fraction of the scene at which the storyboard samples its representative still. */
  keyAt: number;
}

export const SCENES: readonly SceneDef[] = [
  { id: 1, name: "Canvas", duration: 1.2, keyAt: 0.85 },
  { id: 2, name: "Pair", duration: 1.2, keyAt: 0.85 },
  { id: 3, name: "Fan", duration: 1.4, keyAt: 0.9 },
  { id: 4, name: "Dark turn", duration: 1.0, keyAt: 0.6 },
  { id: 5, name: "Collage to colour", duration: 1.2, keyAt: 0.95 },
  { id: 6, name: "Scatter and swirl", duration: 1.4, keyAt: 0.9 },
  { id: 7, name: "Snap shapes", duration: 1.4, keyAt: 0.45 },
  { id: 8, name: "Silhouette burst", duration: 0.8, keyAt: 0.55 },
  { id: 9, name: "Grid and wave", duration: 1.6, keyAt: 0.99 },
  { id: 10, name: "Page flip", duration: 0.8, keyAt: 0.22 },
];

/** Float-safe rounding to a millisecond so boundary maths never drifts (1.2 + 1.2 = 2.4 exactly). */
const ms = (n: number): number => Math.round(n * 1000) / 1000;

export const LOOP_DURATION: number = ms(SCENES.reduce((sum, s) => sum + s.duration, 0));

/** Start time of each scene, same order as SCENES. */
export const SCENE_STARTS: readonly number[] = SCENES.map((_, i) =>
  ms(SCENES.slice(0, i).reduce((sum, s) => sum + s.duration, 0)),
);

export function sceneStart(id: number): number {
  const start = SCENE_STARTS[id - 1];
  if (start === undefined) throw new RangeError(`No scene ${id}`);
  return start;
}

export function sceneEnd(id: number): number {
  return ms(sceneStart(id) + (SCENES[id - 1]?.duration ?? 0));
}

/**
 * Playback speed of the live hero relative to the schedule above (owner feedback: the centre animation played
 * too fast). The Director applies it with `timeline.timeScale()`, so one loop takes `LOOP_DURATION / HERO_TIME_SCALE`
 * seconds on the wall clock (15 s at 0.8). Everything in this file, the storyboard, `__ifonliHero.seek()` and the
 * visual tests stay in loop time: `totalTime()` is not affected by the scale. Keep it at or below 1: a slower
 * timeline only lengthens every dissolve, so the WCAG 2.3.1 guard in `flash.ts` (which reasons in loop time) can
 * only get safer, never worse.
 */
export const HERO_TIME_SCALE = 0.8;

/** Wrap any time into [0, LOOP_DURATION). */
export function wrapTime(t: number): number {
  const m = t % LOOP_DURATION;
  return ms(m < 0 ? m + LOOP_DURATION : m);
}

export interface SceneAt {
  index: number;
  scene: SceneDef;
  /** Seconds since the scene started. */
  local: number;
  /** 0..1 progress through the scene. */
  progress: number;
}

/** Which scene a loop time falls into. A time exactly on a boundary belongs to the scene that starts there. */
export function sceneAt(t: number): SceneAt {
  const time = wrapTime(t);
  let index = SCENES.length - 1;
  for (let i = 0; i < SCENES.length; i += 1) {
    if (time < SCENE_STARTS[i]! + SCENES[i]!.duration - 1e-9) {
      index = i;
      break;
    }
  }
  const scene = SCENES[index]!;
  const local = ms(time - SCENE_STARTS[index]!);
  return { index, scene, local, progress: Math.min(1, local / scene.duration) };
}

/** Loop times of every scene boundary after scene 1, including the wrap back to scene 1 (= LOOP_DURATION). */
export const BOUNDARIES: readonly number[] = [...SCENE_STARTS.slice(1), LOOP_DURATION];

/**
 * A vibe switch dissolves the stage out, swaps the profile and tiles, restarts the loop and dissolves back in.
 * Each half takes this long, in WALL-CLOCK seconds (a plain GSAP tween, not the loop timeline, so a paused loop
 * can never hold a switch up).
 */
export const PROFILE_FADE = 0.3;
/** WCAG 2.3.1 guard: no luminance change is ever faster than this. */
export const MIN_DISSOLVE = 0.2;

/**
 * Wall-clock seconds between the starts of two switch dissolves. One switch is an out and an in (two transitions),
 * so this keeps rapid theme flipping to at most three transitions per second, under the guard in `flash.ts`.
 * Requests that arrive sooner are coalesced: the stage ends on the latest vibe.
 */
export const MIN_SWITCH_SPACING = 0.75;

/** Loop time at which the animation starts: the settled rest frame of scene 9, identical to the static poster. */
export const REST_TIME: number = ms(sceneEnd(9) - 0.3);

/** Representative still of each scene for the dev storyboard (10 per vibe). */
export const STORYBOARD_TIMES: readonly number[] = SCENES.map((s, i) =>
  ms(SCENE_STARTS[i]! + s.duration * s.keyAt),
);

/** Sample timestamps for the visual test: 12 evenly spaced, offset so none lands on a scene boundary. */
export const SAMPLE_TIMES: readonly number[] = Array.from({ length: 12 }, (_, i) =>
  ms(((i + 0.5) * LOOP_DURATION) / 12),
);
