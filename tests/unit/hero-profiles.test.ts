import { describe, expect, it } from "vitest";

import { hash01, hesitate, wobbleAt } from "@/features/hero/stage/eases";
import {
  FIRST_SCENE_LUMINANCE,
  LUMI,
  MAX_FLICKER_AMP,
  MAX_FLICKER_HZ,
  MAX_TRANSITIONS_PER_SECOND,
  checkEvents,
  checkFlashSafety,
  luminanceEvents,
  maxStartsInWindow,
  worstCaseSwitchEvents,
  type LuminanceEvent,
} from "@/features/hero/stage/flash";
import { PROFILES, profileFor } from "@/features/hero/stage/profiles";
import {
  MIN_DISSOLVE,
  MIN_SWITCH_SPACING,
  PROFILE_FADE,
  sceneStart,
} from "@/features/hero/stage/schedule";
import { VIBES } from "@/features/vibe/config";

describe("motion profiles", () => {
  it("has exactly one profile per vibe, each keyed by its own vibe", () => {
    expect(Object.keys(PROFILES).sort()).toEqual([...VIBES].sort());
    for (const v of VIBES) expect(profileFor(v).vibe).toBe(v);
  });

  it("gives each vibe its own personality (no two profiles share an ease set)", () => {
    const key = (v: (typeof VIBES)[number]) =>
      JSON.stringify(
        Object.values(PROFILES[v].ease).map((e) => (typeof e === "string" ? e : "fn")),
      );
    expect(new Set(VIBES.map(key)).size).toBe(VIBES.length);
  });

  it("follows the plan's descriptions", () => {
    expect(PROFILES.cute.ease.move).toMatch(/back\.out/);
    expect(PROFILES.cute.ease.settle).toMatch(/elastic/);
    expect(PROFILES.bold.ease.snap).toMatch(/^steps\(/);
    expect(PROFILES.bold.ease.move).toMatch(/expo/);
    expect(PROFILES.gothic.ease.move).toMatch(/sine/);
    expect(PROFILES.gothic.throughBlack).toBe(true);
    expect(PROFILES.gothic.flicker.amp).toBeGreaterThan(0); // candle flicker
    expect(PROFILES.funky.connector).toBe("wave"); // 70s wave paths
    expect(PROFILES.funky.wobble.amp).toBeGreaterThan(0);
    expect(PROFILES.funky.detour).toBeGreaterThan(0);
  });

  it("uses the dark token that is actually dark in each vibe", () => {
    for (const v of ["gothic", "bold"] as const) expect(PROFILES[v].veilDark).toBe("bg");
    for (const v of ["cute", "funky"] as const) expect(PROFILES[v].veilDark).toBe("ink");
  });
});

describe("easing helpers", () => {
  it("hesitate starts at 0, ends at 1, never goes backwards and really pauses", () => {
    const e = hesitate(0.75);
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
    let prev = 0;
    let flat = 0;
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const v = e(Math.min(1, p));
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      if (Math.abs(v - prev) < 1e-12) flat += 1;
      prev = v;
    }
    expect(flat).toBeGreaterThan(20); // two pauses worth of flat samples
  });

  it("hesitate(0) is a plain monotone ease", () => {
    const e = hesitate(0);
    expect(e(0.5)).toBeGreaterThan(0.3);
    expect(e(1)).toBe(1);
  });

  it("wobble is bounded by its amplitude; hash01 is deterministic and in [0, 1)", () => {
    for (let t = 0; t < 3; t += 0.1)
      expect(Math.abs(wobbleAt(t, 7, 1.6))).toBeLessThanOrEqual(7 + 1e-9);
    expect(hash01(3, 4)).toBe(hash01(3, 4));
    expect(hash01(3, 4)).not.toBe(hash01(4, 3));
    for (let i = 0; i < 200; i += 1) {
      const h = hash01(i, 9);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe("flash-rate guard (WCAG 2.3.1)", () => {
  it("every profile passes: dissolves of 200 ms or more, at most 4 transitions a second, gentle flicker", () => {
    for (const v of VIBES) expect(checkFlashSafety(PROFILES[v])).toEqual([]);
  });

  it("builds the large-area luminance changes from the shared timings", () => {
    for (const v of VIBES) {
      const events = luminanceEvents(PROFILES[v]);
      expect(events).toHaveLength(3);
      expect(events[0]!.at).toBeCloseTo(sceneStart(LUMI.darkIn.scene) + LUMI.darkIn.at, 9);
      for (const e of events) expect(e.duration).toBeGreaterThanOrEqual(MIN_DISSOLVE);
    }
  });

  it("the profile dissolve itself is not faster than 200 ms, and switches are spaced", () => {
    expect(PROFILE_FADE).toBeGreaterThanOrEqual(MIN_DISSOLVE);
    const sw = worstCaseSwitchEvents();
    const outs = sw.filter((e) => e.label.startsWith("switch-out"));
    expect(outs.length).toBeGreaterThan(10);
    outs.slice(1).forEach((e, i) => {
      expect(e.at - outs[i]!.at).toBeGreaterThanOrEqual(MIN_SWITCH_SPACING - 1e-9);
    });
    expect(maxStartsInWindow(sw)).toBeLessThanOrEqual(MAX_TRANSITIONS_PER_SECOND);
  });

  it("scene luminance changes start well after a restart, so they never overlap a switch burst", () => {
    expect(FIRST_SCENE_LUMINANCE).toBeGreaterThanOrEqual(1);
    for (const v of VIBES) {
      for (const e of luminanceEvents(PROFILES[v])) expect(e.at).toBeGreaterThanOrEqual(1);
    }
  });

  it("counts transitions per second including the loop wrap", () => {
    const burst = (at: number): LuminanceEvent => ({ label: "x", at, duration: 0.3, delta: 1 });
    expect(maxStartsInWindow([burst(0), burst(0.4), burst(0.8)])).toBe(3);
    expect(maxStartsInWindow([burst(0), burst(2), burst(4)])).toBe(1);
    // 11.8 and 0.1 are 0.3 s apart across the wrap
    expect(maxStartsInWindow([burst(11.8), burst(0.1), burst(0.3), burst(0.5), burst(0.7)])).toBe(
      5,
    );
  });

  it("flags unsafe profiles: too-fast dissolve, flicker too deep or too fast, too many transitions", () => {
    const base = PROFILES.cute;
    expect(checkFlashSafety({ ...base, flicker: { amp: MAX_FLICKER_AMP, hz: 2 } })).not.toEqual([]);
    expect(
      checkFlashSafety({ ...base, flicker: { amp: 0.05, hz: MAX_FLICKER_HZ + 1 } }),
    ).not.toEqual([]);
    expect(checkFlashSafety({ ...base, darkLevel: 2 })).not.toEqual([]);
    expect(MAX_TRANSITIONS_PER_SECOND).toBeLessThan(6); // the WCAG limit is 3 flashes = 6 transitions
    expect(checkEvents("t", [{ label: "snap", at: 1, duration: 0.05, delta: 1 }])).toHaveLength(1);
    const five = [0, 0.1, 0.2, 0.3, 0.4].map((at) => ({ label: "x", at, duration: 0.3, delta: 1 }));
    expect(checkEvents("t", five)).toHaveLength(1);
    expect(checkEvents("t", five.slice(0, 4))).toEqual([]);
  });
});
