/**
 * Stage geometry: where things go inside the hero box. Pure functions of the measured box, the text card
 * (the keep-out that is never animated away) and the poster cells (so the rest frame matches the poster).
 */
import type { StageLayout } from "./tiles";

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A poster cell: centre and side length, in stage coordinates. */
export interface Cell extends Pt {
  size: number;
}

export interface Geometry {
  layout: StageLayout;
  w: number;
  h: number;
  /** Base tile edge in px; poses scale it. */
  unit: number;
  /** The region focal scenes (canvas, pair, fan, formations) use: the whole box on wide, the strip above the card when stacked. */
  focus: Rect;
  hub: Pt;
  solo: Pt;
  pairA: Pt;
  pairB: Pt;
  /** Text card rect (keep-out), or null when unknown. */
  card: Rect | null;
  /** Poster cell for tile `i`, or null if the poster shows no such tile at this size. */
  cells: (Cell | null)[];
}

export const WIDE_MIN_WIDTH = 1024;

export function layoutFor(width: number): StageLayout {
  return width >= WIDE_MIN_WIDTH ? "wide" : "stacked";
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Synthetic poster cells, mirroring the poster's CSS grid, for when the real DOM is not measured (the dev
 * storyboard and unit tests). Left list takes even tile indices, right list odd ones.
 */
export function syntheticCells(
  layout: StageLayout,
  w: number,
  h: number,
  card: Rect | null,
): Cell[] {
  const gap = 12;
  const cells: Cell[] = [];
  if (layout === "wide") {
    const cardRect = card ?? defaultCard(layout, w, h);
    const lane = Math.max(40, cardRect.x - gap * 2);
    const size = Math.max(24, Math.min((lane - gap) / 2, (h - gap * 3) / 2));
    for (let p = 0; p < 4; p += 1) {
      const col = p % 2;
      const row = Math.floor(p / 2);
      const y = h / 2 + (row === 0 ? -1 : 1) * (size / 2 + gap / 2);
      const left = gap + size / 2 + col * (size + gap);
      const right = w - gap - size / 2 - (1 - col) * (size + gap);
      cells[2 * p] = { x: left, y, size };
      cells[2 * p + 1] = { x: right, y, size };
    }
    return cells;
  }
  const cols = w >= 768 ? 6 : 3;
  const size = (w - gap * 2 - (cols - 1) * gap) / cols;
  const rowsPerList = cols === 6 ? 1 : 2;
  for (let list = 0; list < 2; list += 1) {
    for (let p = 0; p < 6; p += 1) {
      const col = p % cols;
      const row = list * rowsPerList + Math.floor(p / cols);
      cells[2 * p + list] = {
        x: gap + size / 2 + col * (size + gap),
        y: gap + size / 2 + row * (size + gap),
        size,
      };
    }
  }
  return cells;
}

/** The text card as the poster lays it out, for geometry built without measuring. */
export function defaultCard(layout: StageLayout, w: number, h: number): Rect {
  if (layout === "wide") {
    const cw = clamp(w * 0.36, 416, 544);
    const ch = h * 0.9;
    return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
  }
  const ch = Math.min(h * 0.45, 340);
  return { x: 0, y: h - ch, w, h: ch };
}

export interface GeometryInput {
  w: number;
  h: number;
  layout?: StageLayout;
  card?: Rect | null;
  /** Measured poster cells; falls back to `syntheticCells`. */
  cells?: readonly (Cell | null)[];
}

export function computeGeometry(input: GeometryInput): Geometry {
  const w = Math.max(1, input.w);
  const h = Math.max(1, input.h);
  const layout = input.layout ?? layoutFor(w);
  const card = input.card ?? defaultCard(layout, w, h);
  const measured = input.cells?.some((c) => c !== null && c !== undefined) ?? false;
  const cells: (Cell | null)[] = measured
    ? [...(input.cells as (Cell | null)[])]
    : syntheticCells(layout, w, h, card);

  const sizes = cells.filter((c): c is Cell => c !== null && c !== undefined).map((c) => c.size);
  const posterSize = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;

  if (layout === "wide") {
    const unit = posterSize || clamp(h * 0.42, 72, 210);
    const focus: Rect = { x: 0, y: 0, w, h };
    return {
      layout,
      w,
      h,
      unit,
      focus,
      hub: { x: w / 2, y: h / 2 },
      solo: { x: w * 0.19, y: h / 2 },
      pairA: { x: w * 0.19, y: h / 2 },
      pairB: { x: w * 0.81, y: h / 2 },
      card,
      cells,
    };
  }
  const fh = clamp(card.y - 8, h * 0.3, h);
  const unit = posterSize || clamp(Math.min(w * 0.26, fh * 0.4), 64, 150);
  const focus: Rect = { x: 0, y: 0, w, h: fh };
  return {
    layout,
    w,
    h,
    unit,
    focus,
    hub: { x: w / 2, y: fh / 2 },
    solo: { x: w / 2, y: fh / 2 },
    pairA: { x: w * 0.27, y: fh / 2 },
    pairB: { x: w * 0.73, y: fh / 2 },
    card,
    cells,
  };
}
