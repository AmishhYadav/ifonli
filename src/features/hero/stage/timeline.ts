/**
 * The one parameterised timeline (plan section 9): scene modules 1-10 built into a single paused, repeating
 * GSAP timeline for a motion profile and a geometry. Everything is a fromTo between known values, so the
 * playhead can be put at any time (the storyboard and the visual tests do exactly that).
 *
 * Only transforms and opacity are animated, plus stroke-dashoffset for DrawSVG on a handful of small paths.
 */
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";

import type { Geometry } from "./geometry";
import { openingPoses } from "./poses";
import type { MotionProfile } from "./profiles/types";
import type { StageRefs } from "./refs";
import { LOOP_DURATION, SCENES, SCENE_STARTS } from "./schedule";
import { poseVars, type SceneCtx } from "./scenes/helpers";
import { SCENE_BUILDERS } from "./scenes";
import { prepareStatic } from "./scenes/static";

gsap.registerPlugin(DrawSVGPlugin);

/** A string unique to the lazily loaded stage chunk: the tests grep loaded scripts for it. */
export const STAGE_CHUNK_MARKER = "ifonli-hero-stage-chunk-v1";

export interface TimelineInput {
  refs: StageRefs;
  profile: MotionProfile;
  geo: Geometry;
}

/** Candle-glow base opacity (Gothic only; other profiles keep the glow layer at 0). */
const GLOW_BASE = 0.2;

/** Rest backing shape of tile `i`: the poster alternates card, circle, circle, card. */
export const isCircleShape = (i: number): boolean => i % 4 === 1 || i % 4 === 2;

export function buildTimeline({ refs, profile, geo }: TimelineInput): gsap.core.Timeline {
  const n = refs.tiles.length;
  const tl = gsap.timeline({ paused: true, repeat: -1, defaults: { overwrite: false } });
  const mk = (i: number): SceneCtx => ({
    gsap,
    tl,
    t0: SCENE_STARTS[i]!,
    dur: SCENES[i]!.duration,
    profile,
    geo,
    refs,
    n,
  });

  prepareStatic(mk(0));

  // Baseline = the state at the loop start (end of scene 10), applied first so any seek renders from it.
  const base = (targets: gsap.TweenTarget, vars: gsap.TweenVars): void => {
    tl.set(targets, { ...vars, immediateRender: false }, 0);
  };
  const opening = openingPoses(geo, n);
  refs.tiles.forEach((t, i) => {
    base(t.root, { ...poseVars(opening[i]!), yPercent: 0 });
    const circle = isCircleShape(i);
    const opener = i < 2;
    base(t.sq, { opacity: opener ? 1 : 0 });
    base(t.rd, { opacity: opener ? 0 : circle ? 0 : 1 });
    base(t.ci, { opacity: opener ? 0 : circle ? 1 : 0 });
    base(t.hi, { opacity: 0 });
    base(t.img, { rotation: 0 });
  });
  base(refs.canvas, { opacity: 1 });
  base([refs.veilDark, refs.veilSolid, ...refs.badges, ...refs.sils], { opacity: 0 });
  base(refs.streaks, { opacity: 0, skewX: -30 });
  base(refs.tilesLayer, { scale: 1 });
  base(refs.glow, { opacity: profile.flicker.amp > 0 ? GLOW_BASE : 0, scale: 1 });
  base([refs.svg.selection, ...refs.svg.spokes, ...refs.svg.links], { opacity: 0, drawSVG: "0%" });
  base([...refs.svg.handles, ...refs.svg.anchors], { opacity: 0, scale: 0 });

  SCENE_BUILDERS.forEach((build, i) => build(mk(i)));

  addAmbient(tl, refs, profile);

  // Pin the loop length to exactly 12 s whatever the tweens' own ends are.
  tl.set({}, {}, LOOP_DURATION);
  return tl;
}

/** Whole-loop ambient motion: Gothic candle flicker and Funky product wobble. Both are periodic in 12 s. */
function addAmbient(tl: gsap.core.Timeline, refs: StageRefs, profile: MotionProfile): void {
  const { flicker, wobble } = profile;
  if (flicker.amp > 0 && flicker.hz > 0) {
    const cycles = Math.max(2, Math.round(LOOP_DURATION * flicker.hz * 2));
    const half = LOOP_DURATION / cycles;
    tl.fromTo(
      refs.glow,
      { opacity: GLOW_BASE - flicker.amp },
      {
        opacity: GLOW_BASE + flicker.amp,
        duration: half,
        ease: "sine.inOut",
        yoyo: true,
        repeat: cycles - 1,
        immediateRender: false,
      },
      0,
    );
    const sway = 20;
    tl.fromTo(
      refs.glow,
      { scale: 0.97 },
      {
        scale: 1.03,
        duration: LOOP_DURATION / sway,
        ease: "sine.inOut",
        yoyo: true,
        repeat: sway - 1,
        immediateRender: false,
      },
      0,
    );
  }
  if (wobble.amp > 0 && wobble.hz > 0) {
    const cycles = Math.max(2, Math.round(LOOP_DURATION * wobble.hz * 2));
    const half = LOOP_DURATION / cycles;
    refs.tiles.forEach((tile, i) => {
      const sign = i % 2 === 0 ? 1 : -1;
      tl.fromTo(
        tile.img,
        { rotation: -wobble.amp * sign },
        {
          rotation: wobble.amp * sign,
          duration: half,
          ease: "sine.inOut",
          yoyo: true,
          repeat: cycles - 1,
          immediateRender: false,
        },
        0,
      );
    });
  }
}
