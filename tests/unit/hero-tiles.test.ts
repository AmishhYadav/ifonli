import { describe, expect, it } from "vitest";

import {
  MAX_STAGE_TILES,
  STACKED_TILE_COUNT,
  WIDE_TILE_COUNT,
  assignTiles,
  tileCountFor,
  type StageTile,
} from "@/features/hero/stage/tiles";

const make = (n: number): StageTile[] =>
  Array.from({ length: n }, (_, i) => ({
    slug: `p-${i}`,
    name: `Product ${i}`,
    src: `/img/${i}.svg`,
  }));

describe("hero tile assignment", () => {
  it("keeps the DOM tile budget at 60 or fewer", () => {
    expect(WIDE_TILE_COUNT).toBeLessThanOrEqual(MAX_STAGE_TILES);
    expect(STACKED_TILE_COUNT).toBeLessThanOrEqual(MAX_STAGE_TILES);
    expect(tileCountFor("wide")).toBeLessThanOrEqual(60);
    expect(tileCountFor("stacked")).toBeLessThanOrEqual(60);
    expect(assignTiles(make(12), 500)).toHaveLength(MAX_STAGE_TILES);
  });

  it("gives each product one non-duplicate tile when there are enough tiles", () => {
    const a = assignTiles(make(12), 56);
    expect(a).toHaveLength(56);
    expect(a.slice(0, 12).every((x) => !x.duplicate)).toBe(true);
    expect(a.slice(0, 12).map((x) => x.tile.slug)).toEqual(make(12).map((t) => t.slug));
  });

  it("repeats products in order when there are fewer products than tiles, flagging repeats", () => {
    const a = assignTiles(make(3), 8);
    expect(a.map((x) => x.tile.slug)).toEqual([
      "p-0",
      "p-1",
      "p-2",
      "p-0",
      "p-1",
      "p-2",
      "p-0",
      "p-1",
    ]);
    expect(a.map((x) => x.duplicate)).toEqual([false, false, false, true, true, true, true, true]);
    expect(a.map((x) => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("matches the poster: tile i shows product i mod n", () => {
    const tiles = make(5);
    assignTiles(tiles, 12).forEach((x) => expect(x.tile).toBe(tiles[x.index % 5]));
  });

  it("returns nothing for no products or no tiles", () => {
    expect(assignTiles([], 10)).toEqual([]);
    expect(assignTiles(make(4), 0)).toEqual([]);
  });

  it("uses fewer tiles on the stacked (phone) layout", () => {
    expect(tileCountFor("stacked")).toBeLessThan(tileCountFor("wide"));
  });
});
