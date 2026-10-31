import { WAVE_PULSE } from "../flash";
import { gridPoses, implodePoses, waveOrder } from "../poses";

import { fade, fromTo, moveTiles, rankByDistance, type SceneBuilder } from "./helpers";

/**
 * Scene 9 (1.6 s): the full grid assembles at the poster cells and a highlight wave runs across it. The last
 * 0.3 s is the rest frame, identical to the static poster (the animation starts and pauses here).
 */
export const scene09: SceneBuilder = (ctx) => {
  const { refs, profile, geo, n } = ctx;
  const implode = implodePoses(geo, n);
  const grid = gridPoses(geo, n);

  moveTiles(ctx, implode, grid, {
    at: 0,
    dur: 0.55,
    ease: profile.ease.settle,
    rank: rankByDistance(grid, geo.hub),
    stagger: 0.008,
  });

  // Tile 0 settles into its rest frame (rounded), the pair's morph left it a circle.
  const first = refs.tiles[0];
  if (first) {
    fade(ctx, first.ci, 1, 0, 0.3, 0.3);
    fade(ctx, first.rd, 0, 1, 0.3, 0.3);
  }

  // Highlight wave, left to right: a ring layer and a small scale pulse on each cell, once.
  const order = waveOrder(geo, n);
  order.forEach((i, rank) => {
    const tile = refs.tiles[i];
    const cell = geo.cells[i];
    if (!tile || !cell) return;
    const at = 0.5 + rank * 0.03;
    fade(ctx, tile.hi, 0, 1, at, WAVE_PULSE.up);
    fade(ctx, tile.hi, 1, 0, at + WAVE_PULSE.up, WAVE_PULSE.down);
    const s = cell.size / geo.unit;
    fromTo(
      ctx,
      tile.root,
      { scale: s },
      { scale: s * 1.1, duration: WAVE_PULSE.up, ease: profile.ease.pop },
      at,
    );
    fromTo(
      ctx,
      tile.root,
      { scale: s * 1.1 },
      { scale: s, duration: WAVE_PULSE.down, ease: profile.ease.settle },
      at + WAVE_PULSE.up,
    );
  });
};
