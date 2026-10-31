import type { gsap as GsapInstance } from "gsap";

import type { EaseSpec } from "../eases";
import type { Geometry } from "../geometry";
import { samePose, type Pose } from "../poses";
import type { MotionProfile } from "../profiles/types";
import type { StageRefs } from "../refs";

export type Timeline = gsap.core.Timeline;
export type Vars = gsap.TweenVars;

export interface SceneCtx {
  gsap: typeof GsapInstance;
  /** The master timeline; all positions below are absolute master time (`t0` + scene-local seconds). */
  tl: Timeline;
  t0: number;
  dur: number;
  profile: MotionProfile;
  geo: Geometry;
  refs: StageRefs;
  /** Number of stage tiles. */
  n: number;
}

/** A scene module: builds its tweens into the master timeline. */
export type SceneBuilder = (ctx: SceneCtx) => void;

export const poseVars = (p: Pose): Vars => ({
  x: p.x,
  y: p.y,
  scale: p.s,
  rotation: p.r,
  rotationY: p.ry,
  opacity: p.o,
});

/** Only the properties that differ, so tweens from different scenes never fight over one that does not change. */
export function diffVars(a: Pose, b: Pose): { from: Vars; to: Vars } {
  const from: Vars = {};
  const to: Vars = {};
  const pairs: [keyof Pose, string][] = [
    ["x", "x"],
    ["y", "y"],
    ["s", "scale"],
    ["r", "rotation"],
    ["ry", "rotationY"],
    ["o", "opacity"],
  ];
  for (const [key, prop] of pairs) {
    if (Math.abs(a[key] - b[key]) > 1e-4) {
      from[prop] = a[key];
      to[prop] = b[key];
    }
  }
  return { from, to };
}

/** Every tween is a fromTo between known values and never renders early: that is what makes seeking exact. */
const base = { immediateRender: false } as const;

export function fromTo(
  ctx: SceneCtx,
  targets: gsap.TweenTarget,
  from: Vars,
  to: Vars,
  at: number,
): void {
  ctx.tl.fromTo(targets, from, { ...to, ...base }, ctx.t0 + at);
}

/** Opacity change in one frame (the element is covered or already invisible when this runs). */
export function toggle(
  ctx: SceneCtx,
  targets: gsap.TweenTarget,
  visible: boolean,
  at: number,
): void {
  fromTo(
    ctx,
    targets,
    { opacity: visible ? 0 : 1 },
    { opacity: visible ? 1 : 0, duration: 0.001 },
    at,
  );
}

export function fade(
  ctx: SceneCtx,
  targets: gsap.TweenTarget,
  from: number,
  to: number,
  at: number,
  duration: number,
  ease: EaseSpec = "sine.inOut",
): void {
  fromTo(ctx, targets, { opacity: from }, { opacity: to, duration, ease }, at);
}

export interface MoveOptions {
  /** Scene-local start. */
  at: number;
  /** Time for the whole move including the stagger spread. */
  dur: number;
  ease: EaseSpec;
  /** Seconds between neighbouring ranks. Default: the profile stagger. */
  stagger?: number;
  /** Rank of tile `i` in the stagger order. Default: its index. */
  rank?: (i: number) => number;
  /** Skip the profile detour (arc) for this move. */
  straight?: boolean;
}

/**
 * Tween every tile from one pose to another. Tiles whose pose does not change, or that stay invisible
 * throughout, get no tween. The stagger is spread inside `dur` so the move always ends at `at + dur`.
 */
export function moveTiles(
  ctx: SceneCtx,
  from: readonly Pose[],
  to: readonly Pose[],
  o: MoveOptions,
): void {
  const stagger = o.stagger ?? ctx.profile.stagger;
  const rank = o.rank ?? ((i: number) => i);
  const moving: number[] = [];
  for (let i = 0; i < ctx.n; i += 1) {
    const a = from[i]!;
    const b = to[i]!;
    if (samePose(a, b)) continue;
    if (a.o === 0 && b.o === 0) continue;
    moving.push(i);
  }
  if (moving.length === 0) return;
  const maxRank = Math.max(...moving.map(rank));
  const spread = Math.min(stagger * maxRank, o.dur * 0.6);
  const per = maxRank > 0 ? spread / maxRank : 0;
  const d = Math.max(0.15, o.dur - spread);
  for (const i of moving) {
    const tile = ctx.refs.tiles[i]!.root;
    const delay = rank(i) * per;
    const a = from[i]!;
    const b = to[i]!;
    const diff = diffVars(a, b);
    fromTo(ctx, tile, diff.from, { ...diff.to, duration: d, ease: o.ease }, o.at + delay);
    const travelled = Math.hypot(b.x - a.x, b.y - a.y);
    if (!o.straight && ctx.profile.detour > 0 && travelled > ctx.geo.unit * 0.4) {
      // Wavy detour (Funky): a sideways arc on top of the move, in percent of the tile, there and back.
      const sign = i % 2 === 0 ? 1 : -1;
      fromTo(
        ctx,
        tile,
        { yPercent: 0 },
        {
          yPercent: sign * ctx.profile.detour * 100,
          duration: d / 2,
          ease: "sine.inOut",
          yoyo: true,
          repeat: 1,
        },
        o.at + delay,
      );
    }
  }
}

/** Order tiles by distance from a point (nearest first), as a rank function. */
export function rankByDistance(
  poses: readonly Pose[],
  from: { x: number; y: number },
): (i: number) => number {
  const order = poses
    .map((p, i) => ({ i, d: Math.hypot(p.x - from.x, p.y - from.y) }))
    .sort((a, b) => a.d - b.d || a.i - b.i);
  const rank = new Map(order.map((e, r) => [e.i, r]));
  return (i) => rank.get(i) ?? i;
}
