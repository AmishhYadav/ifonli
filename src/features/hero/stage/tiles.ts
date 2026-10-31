/** Product tiles of the hero stage: data shape, repetition and DOM budget. */

export interface StageTile {
  slug: string;
  name: string;
  /** Same-origin (or already allowed) image URL, produced on the server with next/image. */
  src: string;
}

export interface TileAssignment {
  /** Position in the stage; tile `i` is also poster tile `i`. */
  index: number;
  tile: StageTile;
  /** Repeated to fill the grid: hidden from assistive tech and the tab order. */
  duplicate: boolean;
}

/** Plan section 13: at most 60 animated tiles in the DOM. */
export const MAX_STAGE_TILES = 60;
export const WIDE_TILE_COUNT = 56;
export const STACKED_TILE_COUNT = 36;

export type StageLayout = "wide" | "stacked";

export function tileCountFor(layout: StageLayout): number {
  return Math.min(MAX_STAGE_TILES, layout === "wide" ? WIDE_TILE_COUNT : STACKED_TILE_COUNT);
}

/**
 * Assign products to `count` stage tiles. Fewer products than tiles: they repeat in order (plan section 9),
 * and every repeat is flagged `duplicate` so it can be hidden from the accessibility tree and the tab order.
 * No products: no tiles (the stage does not mount).
 */
export function assignTiles(tiles: readonly StageTile[], count: number): TileAssignment[] {
  if (tiles.length === 0 || count <= 0) return [];
  const n = Math.min(count, MAX_STAGE_TILES);
  return Array.from({ length: n }, (_, index) => ({
    index,
    tile: tiles[index % tiles.length]!,
    duplicate: index >= tiles.length,
  }));
}
