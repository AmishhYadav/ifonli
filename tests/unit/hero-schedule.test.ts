import { describe, expect, it } from "vitest";

import {
  BOUNDARIES,
  HERO_TIME_SCALE,
  MIN_DISSOLVE,
  LOOP_DURATION,
  MIN_SWITCH_SPACING,
  PROFILE_FADE,
  REST_TIME,
  SAMPLE_TIMES,
  SCENES,
  SCENE_STARTS,
  STORYBOARD_TIMES,
  sceneAt,
  sceneEnd,
  sceneStart,
  wrapTime,
} from "@/features/hero/stage/schedule";

describe("hero schedule (plan section 9)", () => {
  it("has ten scenes with the planned durations, 12 s in total", () => {
    expect(SCENES.map((s) => s.duration)).toEqual([
      1.2, 1.2, 1.4, 1.0, 1.2, 1.4, 1.4, 0.8, 1.6, 0.8,
    ]);
    expect(SCENES.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(LOOP_DURATION).toBe(12);
  });

  it("plays slower than the schedule, never faster, so loop-time flash limits only get safer", () => {
    expect(HERO_TIME_SCALE).toBeGreaterThan(0.5); // a "little" slower, not a slideshow
    expect(HERO_TIME_SCALE).toBeLessThanOrEqual(1);
    // Wall-clock length of the shortest dissolve and of one loop.
    expect(PROFILE_FADE / HERO_TIME_SCALE).toBeGreaterThanOrEqual(MIN_DISSOLVE);
    expect(LOOP_DURATION / HERO_TIME_SCALE).toBeCloseTo(15, 6);
  });

  it("starts each scene where the previous one ends, without float drift", () => {
    expect(SCENE_STARTS).toEqual([0, 1.2, 2.4, 3.8, 4.8, 6, 7.4, 8.8, 9.6, 11.2]);
    SCENES.forEach((s, i) => {
      expect(sceneEnd(s.id)).toBe(i === SCENES.length - 1 ? LOOP_DURATION : SCENE_STARTS[i + 1]);
    });
    expect(() => sceneStart(11)).toThrow(RangeError);
  });

  it("finds the scene at a time; a boundary belongs to the scene that starts there", () => {
    expect(sceneAt(0).scene.id).toBe(1);
    expect(sceneAt(1.199).scene.id).toBe(1);
    expect(sceneAt(1.2).scene.id).toBe(2);
    expect(sceneAt(3.8).scene.id).toBe(4);
    expect(sceneAt(11.999).scene.id).toBe(10);
    expect(sceneAt(12).scene.id).toBe(1); // wraps
    expect(sceneAt(12 + 2.5).scene.id).toBe(3);
    expect(sceneAt(-0.1).scene.id).toBe(10);
    const mid = sceneAt(4.8 + 0.6);
    expect(mid.index).toBe(4);
    expect(mid.local).toBeCloseTo(0.6, 6);
    expect(mid.progress).toBeCloseTo(0.5, 6);
  });

  it("wraps time into the loop", () => {
    expect(wrapTime(12)).toBe(0);
    expect(wrapTime(25.5)).toBe(1.5);
    expect(wrapTime(-1)).toBe(11);
  });

  it("lists the boundaries including the wrap to scene 1", () => {
    expect(BOUNDARIES).toEqual([1.2, 2.4, 3.8, 4.8, 6, 7.4, 8.8, 9.6, 11.2, 12]);
  });
});

describe("vibe switch timing", () => {
  it("dissolves in wall-clock time no faster than the WCAG guard allows", () => {
    expect(PROFILE_FADE).toBeGreaterThanOrEqual(MIN_DISSOLVE);
    // the new theme is on stage within about half a second of the click
    expect(PROFILE_FADE).toBeLessThanOrEqual(0.45);
  });

  it("spaces dissolve starts so that out and in stay at three transitions per second at most", () => {
    expect(MIN_SWITCH_SPACING).toBeGreaterThanOrEqual(PROFILE_FADE * 2);
    expect(2 / MIN_SWITCH_SPACING).toBeLessThanOrEqual(3);
  });
});

describe("rest frame, storyboard and sample timestamps", () => {
  it("starts on the settled rest frame of scene 9 (the poster)", () => {
    const at = sceneAt(REST_TIME);
    expect(at.scene.id).toBe(9);
    expect(at.progress).toBeGreaterThan(0.75);
    expect(REST_TIME).toBeLessThan(sceneEnd(9));
  });

  it("samples one representative frame inside each of the 10 scenes", () => {
    expect(STORYBOARD_TIMES).toHaveLength(10);
    STORYBOARD_TIMES.forEach((t, i) => expect(sceneAt(t).index).toBe(i));
  });

  it("has 12 evenly spaced samples, none on a scene boundary, covering every scene", () => {
    expect(SAMPLE_TIMES).toHaveLength(12);
    for (const t of SAMPLE_TIMES) {
      expect(BOUNDARIES.some((b) => Math.abs(b - t) < 0.05)).toBe(false);
    }
    expect(new Set(SAMPLE_TIMES.map((t) => sceneAt(t).index)).size).toBeGreaterThanOrEqual(9);
  });
});
