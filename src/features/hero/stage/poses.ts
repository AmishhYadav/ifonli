/**
 * Tile poses for every scene: pure functions of the geometry and the tile count. The end pose of scene `k`
 * is the start pose of scene `k + 1` by construction (`scenePoses`), which is what makes the loop seekable:
 * every tween is a fromTo between two known poses.
 */
import { hash01 } from "./eases";
import type { Geometry, Pt } from "./geometry";

export interface Pose {
  x: number;
  y: number;
  /** Uniform scale relative to the base tile edge (`geo.unit`). */
  s: number;
  /** Rotation about z, degrees. */
  r: number;
  /** Rotation about y, degrees (page flip, 3D turn). */
  ry: number;
  o: number;
}

export const pose = (p: Pt, s = 1, r = 0, o = 1, ry = 0): Pose => ({ x: p.x, y: p.y, s, r, ry, o });

/** Parked, invisible, small, at a point. */
export const hiddenAt = (p: Pt, r = 0): Pose => ({ x: p.x, y: p.y, s: 0.3, r, ry: 0, o: 0 });

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    s: lerp(a.s, b.s, t),
    r: lerp(a.r, b.r, t),
    ry: lerp(a.ry, b.ry, t),
    o: lerp(a.o, b.o, t),
  };
}

export function samePose(a: Pose, b: Pose): boolean {
  return (
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01 &&
    Math.abs(a.s - b.s) < 0.0005 &&
    Math.abs(a.r - b.r) < 0.01 &&
    Math.abs(a.ry - b.ry) < 0.01 &&
    Math.abs(a.o - b.o) < 0.0005
  );
}

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = 2.399963229728653;
const deg = (rad: number): number => (rad * 180) / Math.PI;

const fill = (n: number, make: (i: number) => Pose): Pose[] =>
  Array.from({ length: n }, (_, i) => make(i));

/** Position along a polar interpolation about `hub`: radius and angle interpolate, with `turns` extra revolutions. */
export function swirlPoint(from: Pt, to: Pt, hub: Pt, t: number, turns = 1): Pt {
  const a0 = Math.atan2(from.y - hub.y, from.x - hub.x);
  const a1 = Math.atan2(to.y - hub.y, to.x - hub.x);
  let d = a1 - a0;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  d += turns * TAU;
  const r0 = Math.hypot(from.x - hub.x, from.y - hub.y);
  const r1 = Math.hypot(to.x - hub.x, to.y - hub.y);
  const a = a0 + d * t;
  const r = lerp(r0, r1, t);
  return { x: hub.x + Math.cos(a) * r, y: hub.y + Math.sin(a) * r };
}

// ---------------------------------------------------------------------------------------------------------
// Scene 1 and 10 end: one large tile on the canvas
// ---------------------------------------------------------------------------------------------------------

export const SOLO_SCALE = 1.5;
export const PAIR_SCALE = 1.45;

export function openingPoses(geo: Geometry, n: number): Pose[] {
  return fill(n, (i) => (i === 0 ? pose(geo.solo, SOLO_SCALE) : hiddenAt(geo.solo)));
}

// Scene 2: a pair.
export function pairPoses(geo: Geometry, n: number): Pose[] {
  const mid = { x: (geo.pairA.x + geo.pairB.x) / 2, y: (geo.pairA.y + geo.pairB.y) / 2 };
  return fill(n, (i) =>
    i === 0 ? pose(geo.pairA, PAIR_SCALE) : i === 1 ? pose(geo.pairB, PAIR_SCALE) : hiddenAt(mid),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Scene 3: small tiles on spokes, large highlighted heroes
// ---------------------------------------------------------------------------------------------------------

export const SPOKES = 12;
export const FAN_TILES = 24;

export function ellipseRadii(geo: Geometry): { rx: number; ry: number } {
  return { rx: geo.focus.w * 0.47, ry: geo.focus.h * 0.44 };
}

/** Where the spoke `k` (0..SPOKES-1) ends, on the focus ellipse. */
export function spokeEnd(geo: Geometry, k: number): Pt {
  const { rx, ry } = ellipseRadii(geo);
  const a = ((k + 0.5) / SPOKES) * TAU;
  return { x: geo.hub.x + Math.cos(a) * rx, y: geo.hub.y + Math.sin(a) * ry };
}

export function thirdHero(geo: Geometry): Pt {
  return geo.layout === "wide"
    ? { x: geo.w * 0.33, y: geo.h * 0.8 }
    : { x: geo.hub.x, y: geo.hub.y };
}

export function fanPoses(geo: Geometry, n: number): Pose[] {
  const { rx, ry } = ellipseRadii(geo);
  return fill(n, (i) => {
    if (i === 0) return pose(geo.pairA, 1.7);
    if (i === 1) return pose(geo.pairB, 1.7);
    if (i === 2) return pose(thirdHero(geo), 1.3, 4);
    const j = i - 3;
    if (j >= FAN_TILES) return hiddenAt(geo.hub);
    const spoke = j % SPOKES;
    const ring = Math.floor(j / SPOKES);
    const a = ((spoke + 0.5) / SPOKES) * TAU;
    const frac = 0.52 + 0.4 * ring;
    return pose(
      { x: geo.hub.x + Math.cos(a) * rx * frac, y: geo.hub.y + Math.sin(a) * ry * frac },
      0.5 + 0.12 * ring,
      deg(a) / 6,
    );
  });
}

// ---------------------------------------------------------------------------------------------------------
// Scene 4: conveyor rows (3D turn, one horizontal echo); scene 5: dense collage
// ---------------------------------------------------------------------------------------------------------

export interface RowsInfo {
  rows: number;
  cols: number;
  shown: number;
}

export function rowsInfo(geo: Geometry, n: number): RowsInfo {
  const rows = geo.layout === "wide" ? 4 : 3;
  const shown = Math.min(n, geo.layout === "wide" ? 32 : 21);
  return { rows, cols: Math.ceil(shown / rows), shown };
}

export function rowIndexOf(info: RowsInfo, i: number): number {
  return Math.floor(i / info.cols);
}

export function rowPoses(geo: Geometry, n: number): Pose[] {
  const info = rowsInfo(geo, n);
  const cw = geo.w / info.cols;
  const rh = geo.h / info.rows;
  return fill(n, (i) => {
    if (i >= info.shown) return hiddenAt(geo.hub);
    const row = rowIndexOf(info, i);
    const col = i % info.cols;
    const shift = row % 2 === 1 ? cw / 2 : 0;
    return pose(
      { x: Math.min(geo.w - cw / 2, (col + 0.5) * cw + shift), y: (row + 0.5) * rh },
      (Math.min(cw, rh) / geo.unit) * 0.9,
      0,
      1,
    );
  });
}

export function denseInfo(geo: Geometry, n: number): { rows: number; cols: number } {
  const rows = Math.min(8, Math.max(2, Math.round(Math.sqrt((n * geo.h) / geo.w))));
  return { rows, cols: Math.ceil(n / rows) };
}

export function densePoses(geo: Geometry, n: number): Pose[] {
  const { rows, cols } = denseInfo(geo, n);
  const cw = geo.w / cols;
  const rh = geo.h / rows;
  const s = (Math.max(cw, rh) / geo.unit) * 1.25;
  return fill(n, (i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    return pose({ x: (col + 0.5) * cw, y: (row + 0.5) * rh }, s, (hash01(i, 5) - 0.5) * 10);
  });
}

/** How far the tile layer zooms in scene 5. */
export const COLLAGE_ZOOM = 1.7;

// ---------------------------------------------------------------------------------------------------------
// Scene 6: scatter, spiral, ring clusters
// ---------------------------------------------------------------------------------------------------------

export function scatterPoses(geo: Geometry, n: number): Pose[] {
  return fill(n, (i) =>
    pose(
      { x: hash01(i, 1) * geo.w, y: hash01(i, 2) * geo.h },
      0.45 + hash01(i, 3) * 0.5,
      (hash01(i, 4) - 0.5) * 70,
    ),
  );
}

export const SPIRAL_TILES = 40;

export function spiralPoses(geo: Geometry, n: number): Pose[] {
  const { rx, ry } = ellipseRadii(geo);
  return fill(n, (i) => {
    if (i >= SPIRAL_TILES) return hiddenAt(geo.hub);
    const a = i * GOLDEN_ANGLE;
    const rad = Math.sqrt((i + 0.5) / SPIRAL_TILES);
    return pose(
      { x: geo.hub.x + Math.cos(a) * rad * rx, y: geo.hub.y + Math.sin(a) * rad * ry },
      0.36 + 0.4 * (1 - rad),
      deg(a) * 0.25,
    );
  });
}

export const RING_OUTER = 8;
export const RING_INNER = 4;

/** Two ring clusters around the pair positions (even tiles on the left, odd on the right). */
export function ringPoses(geo: Geometry, n: number): Pose[] {
  const radius = Math.max(
    geo.unit * 0.5,
    Math.min(geo.unit * 1.0, Math.min(geo.focus.h / 2, geo.w * 0.22) - geo.unit * 0.4),
  );
  return fill(n, (i) => {
    const centre = i % 2 === 0 ? geo.pairA : geo.pairB;
    const k = Math.floor(i / 2);
    if (k < RING_OUTER) {
      const a = (k / RING_OUTER) * TAU;
      return pose(
        { x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius },
        0.7,
        deg(a),
      );
    }
    if (k < RING_OUTER + RING_INNER) {
      const a = ((k - RING_OUTER) / RING_INNER) * TAU + Math.PI / 4;
      return pose(
        { x: centre.x + Math.cos(a) * radius * 0.45, y: centre.y + Math.sin(a) * radius * 0.45 },
        0.55,
        deg(a),
      );
    }
    return hiddenAt(centre);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Scene 7: cross, checkerboard, strip
// ---------------------------------------------------------------------------------------------------------

export type Formation = "cross" | "checker" | "strip";

export function formationStep(geo: Geometry): number {
  return Math.min(geo.unit * 0.85, geo.focus.h / 4.4);
}

/** Tile centres of a formation, in slot order (tile `i` takes slot `i`). */
export function formationPoints(geo: Geometry, kind: Formation, n: number): Pt[] {
  const step = formationStep(geo);
  const { focus, hub } = geo;
  const pts: Pt[] = [];
  if (kind === "cross") {
    const mH = Math.max(3, Math.min(13, Math.floor((focus.w * 0.7) / step) | 1));
    const mV = Math.max(3, Math.min(7, Math.floor((focus.h * 0.9) / step) | 1));
    for (let k = 0; k < mH; k += 1) pts.push({ x: hub.x + (k - (mH - 1) / 2) * step, y: hub.y });
    for (let k = 0; k < mV; k += 1) {
      if (k === (mV - 1) / 2) continue;
      pts.push({ x: hub.x, y: hub.y + (k - (mV - 1) / 2) * step });
    }
  } else if (kind === "checker") {
    const cols = Math.max(2, Math.floor(focus.w / step));
    const rows = Math.max(2, Math.floor(focus.h / step));
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if ((c + r) % 2 === 0) {
          pts.push({
            x: focus.x + (c + 0.5) * (focus.w / cols),
            y: focus.y + (r + 0.5) * (focus.h / rows),
          });
        }
      }
    }
  } else {
    const m = Math.max(3, Math.min(n, Math.floor(focus.w / (step * 0.85))));
    for (let k = 0; k < m; k += 1) {
      pts.push({ x: step / 2 + (k * (focus.w - step)) / (m - 1), y: hub.y });
    }
  }
  return pts.slice(0, n);
}

export function formationPoses(geo: Geometry, kind: Formation, n: number): Pose[] {
  const pts = formationPoints(geo, kind, n);
  const s = (formationStep(geo) / geo.unit) * 0.92;
  return fill(n, (i) => {
    const p = pts[i];
    return p ? pose(p, s) : hiddenAt(geo.hub);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Scene 8: implode to the hub; scene 9: the poster grid
// ---------------------------------------------------------------------------------------------------------

export function implodePoses(geo: Geometry, n: number): Pose[] {
  return fill(n, (i) => hiddenAt(geo.hub, (hash01(i, 9) - 0.5) * 40));
}

/** Tile `i` at its poster cell (rest frame), or parked invisible at the hub when the poster shows none. */
export function gridPoses(geo: Geometry, n: number): Pose[] {
  return fill(n, (i) => {
    const cell = geo.cells[i];
    return cell ? pose(cell, cell.size / geo.unit) : hiddenAt(geo.hub);
  });
}

/** Poster-cell order for the highlight wave: left to right, then top to bottom. */
export function waveOrder(geo: Geometry, n: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i += 1) if (geo.cells[i]) ids.push(i);
  return ids.sort((a, b) => {
    const ca = geo.cells[a]!;
    const cb = geo.cells[b]!;
    return ca.x - cb.x || ca.y - cb.y;
  });
}

/** End pose of scene `id` (1..10). Scene `k + 1` starts from `scenePoses(k)`. */
export function scenePoses(id: number, geo: Geometry, n: number): Pose[] {
  switch (id) {
    case 1:
      return openingPoses(geo, n);
    case 2:
      return pairPoses(geo, n);
    case 3:
      return fanPoses(geo, n);
    case 4:
      return rowPoses(geo, n);
    case 5:
      return densePoses(geo, n);
    case 6:
      return ringPoses(geo, n);
    case 7:
      return formationPoses(geo, "strip", n);
    case 8:
      return implodePoses(geo, n);
    case 9:
      return gridPoses(geo, n);
    case 10:
      return openingPoses(geo, n);
    default:
      throw new RangeError(`No scene ${id}`);
  }
}
