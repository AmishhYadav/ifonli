import type { EaseFn } from "../eases";
import { gridPoses, hiddenAt, SOLO_SCALE, waveOrder } from "../poses";

import { fade, fromTo, poseVars, type SceneBuilder } from "./helpers";

const FLIP_DEG = -100;
const FLIP_RAD = (Math.abs(FLIP_DEG) * Math.PI) / 180;

/**
 * Scene 10 (0.8 s): book-page flip back to the opening tile. Every tile turns like a page about its left
 * edge (a turn about its centre plus the matching sideways shift, so only transforms are animated), then the
 * opening tile settles on the design canvas, which fades back in.
 */
export const scene10: SceneBuilder = (ctx) => {
  const { refs, profile, geo, n } = ctx;
  const grid = gridPoses(geo, n);
  const order = waveOrder(geo, n);
  const rankOf = new Map(order.map((i, r) => [i, r]));
  const ease = ctx.gsap.parseEase(profile.ease.flip) as EaseFn;
  // Left-edge hinge: the centre swings in by (w/2)(1 - cos theta) as the page turns.
  const hingeEase: EaseFn = (p) => (1 - Math.cos(FLIP_RAD * ease(p))) / (1 - Math.cos(FLIP_RAD));

  fade(ctx, refs.canvas, 0, 1, 0.05, 0.6);

  // Tile 0 turns from its rounded frame back to the square frame while it is flipping away.
  const first = refs.tiles[0];
  if (first) {
    fade(ctx, first.rd, 1, 0, 0.15, 0.25);
    fade(ctx, first.sq, 0, 1, 0.15, 0.25);
  }

  order.forEach((i) => {
    const tile = refs.tiles[i]!.root;
    const cell = geo.cells[i]!;
    const delay = (rankOf.get(i) ?? 0) * 0.02;
    const shift = (cell.size / 2) * (1 - Math.cos(FLIP_RAD));
    fromTo(
      ctx,
      tile,
      { rotationY: 0, opacity: 1 },
      { rotationY: FLIP_DEG, opacity: 0, duration: 0.34, ease },
      delay,
    );
    fromTo(ctx, tile, { x: cell.x }, { x: cell.x - shift, duration: 0.34, ease: hingeEase }, delay);
    // Park the flipped page at the opening position, invisible.
    const away = { ...grid[i]!, x: cell.x - shift, ry: FLIP_DEG, o: 0 };
    fromTo(ctx, tile, poseVars(away), { ...poseVars(hiddenAt(geo.solo)), duration: 0.001 }, 0.45);
  });

  // Tile 0 reappears as the opening tile.
  fromTo(
    ctx,
    refs.tiles[0]!.root,
    { scale: SOLO_SCALE * 0.8, opacity: 0 },
    { scale: SOLO_SCALE, opacity: 1, duration: 0.3, ease: profile.ease.pop },
    0.5,
  );
};
