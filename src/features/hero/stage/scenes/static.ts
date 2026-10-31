/**
 * Geometry-dependent but time-independent markup: SVG paths, handle and anchor positions. Written once per
 * build (not tweened), so every scene can rely on them whatever the playhead does.
 */
import { chainPath, connectorPath, rectPath, spokePath } from "../connectors";
import type { Pt } from "../geometry";
import { PAIR_SCALE, SOLO_SCALE, SPOKES, formationPoints, spokeEnd } from "../poses";

import type { SceneCtx } from "./helpers";

/** Anchor circle allocation. */
export const ANCHOR = {
  pair: [0, 1],
  cross: [2, 3, 4, 5],
  checker: [6, 7, 8, 9],
  strip: [10, 11, 12],
} as const;

/** Link path allocation. */
export const LINK = { pair: 0, crossH: 1, crossV: 2, checker: 3, strip: 4 } as const;

export function selectionBox(ctx: SceneCtx): { c: Pt; size: number } {
  return { c: ctx.geo.solo, size: ctx.geo.unit * SOLO_SCALE + 18 };
}

/** The eight resize handles of the selection frame: corners and edge midpoints. */
export function handlePoints(ctx: SceneCtx): Pt[] {
  const { c, size } = selectionBox(ctx);
  const h = size / 2;
  return [
    { x: c.x - h, y: c.y - h },
    { x: c.x, y: c.y - h },
    { x: c.x + h, y: c.y - h },
    { x: c.x + h, y: c.y },
    { x: c.x + h, y: c.y + h },
    { x: c.x, y: c.y + h },
    { x: c.x - h, y: c.y + h },
    { x: c.x - h, y: c.y },
  ];
}

export function pairEnds(ctx: SceneCtx): { a: Pt; b: Pt } {
  const half = (ctx.geo.unit * PAIR_SCALE) / 2;
  const { pairA, pairB } = ctx.geo;
  // Connect the facing edges (wide) or the facing sides (stacked): both pairs sit on one horizontal line.
  return { a: { x: pairA.x + half, y: pairA.y }, b: { x: pairB.x - half, y: pairB.y } };
}

function setAttrs(ctx: SceneCtx, el: Element, attr: Record<string, string | number>): void {
  ctx.gsap.set(el, { attr });
}

export function prepareStatic(ctx: SceneCtx): void {
  const { svg } = ctx.refs;
  const { geo, profile } = ctx;
  setAttrs(ctx, svg.root, { viewBox: `0 0 ${geo.w} ${geo.h}`, width: geo.w, height: geo.h });

  // Scene 1: selection frame and handles.
  const { c, size } = selectionBox(ctx);
  setAttrs(ctx, svg.selection, { d: rectPath(c, size, size) });
  handlePoints(ctx).forEach((p, i) => {
    const el = svg.handles[i];
    if (el) setAttrs(ctx, el, { cx: p.x, cy: p.y, r: 5 });
  });

  // Scene 2: connector between the pair, with anchor dots at both ends.
  const { a, b } = pairEnds(ctx);
  setAttrs(ctx, svg.links[LINK.pair]!, { d: connectorPath(profile.connector, a, b, 3) });
  [a, b].forEach((p, i) => {
    const el = svg.anchors[ANCHOR.pair[i]!];
    if (el) setAttrs(ctx, el, { cx: p.x, cy: p.y, r: 5 });
  });

  // Scene 3: spokes from the hub.
  for (let k = 0; k < SPOKES; k += 1) {
    const el = svg.spokes[k];
    if (el) setAttrs(ctx, el, { d: spokePath(geo.hub, spokeEnd(geo, k)) });
  }

  // Scene 7: formation connectors and anchors.
  const cross = formationPoints(geo, "cross", ctx.n);
  const row = cross.filter((p) => Math.abs(p.y - geo.hub.y) < 0.5).sort((p, q) => p.x - q.x);
  const col = cross.filter((p) => Math.abs(p.x - geo.hub.x) < 0.5).sort((p, q) => p.y - q.y);
  setAttrs(ctx, svg.links[LINK.crossH]!, { d: chainPath(profile.connector, row, 5) });
  setAttrs(ctx, svg.links[LINK.crossV]!, { d: chainPath(profile.connector, col, 9) });
  const crossEnds = [row[0], row[row.length - 1], col[0], col[col.length - 1]];
  crossEnds.forEach((p, i) => {
    const el = svg.anchors[ANCHOR.cross[i]!];
    if (p && el) setAttrs(ctx, el, { cx: p.x, cy: p.y, r: 5 });
  });

  const checker = formationPoints(geo, "checker", ctx.n);
  const zig = [...checker].sort((p, q) => p.x - q.x || p.y - q.y).slice(0, 9);
  setAttrs(ctx, svg.links[LINK.checker]!, { d: chainPath(profile.connector, zig, 13) });
  const xs = checker.map((p) => p.x);
  const ys = checker.map((p) => p.y);
  const corners: Pt[] = [
    { x: Math.min(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.max(...ys) },
    { x: Math.min(...xs), y: Math.max(...ys) },
  ];
  corners.forEach((p, i) => {
    const el = svg.anchors[ANCHOR.checker[i]!];
    if (el && checker.length) setAttrs(ctx, el, { cx: p.x, cy: p.y, r: 5 });
  });

  const strip = formationPoints(geo, "strip", ctx.n);
  setAttrs(ctx, svg.links[LINK.strip]!, { d: chainPath(profile.connector, strip, 21) });
  const stripDots = [strip[0], strip[Math.floor(strip.length / 2)], strip[strip.length - 1]];
  stripDots.forEach((p, i) => {
    const el = svg.anchors[ANCHOR.strip[i]!];
    if (p && el) setAttrs(ctx, el, { cx: p.x, cy: p.y, r: 5 });
  });
}
