import { LUMINANCE_EASE } from "../eases";
import { LUMI } from "../flash";
import { fanPoses, rowIndexOf, rowPoses, rowsInfo, SPOKES } from "../poses";

import { fade, fromTo, moveTiles, type SceneBuilder } from "./helpers";

/**
 * Scene 4 (1.0 s): dark transition. The stage goes dark (a cross-dissolve, never a cut), tiles turn in 3D
 * onto conveyor rows with shadow streaks, and one row echoes the first a beat later.
 */
export const scene04: SceneBuilder = (ctx) => {
  const { refs, profile, geo, n } = ctx;
  const info = rowsInfo(geo, n);

  // Spokes and rings go.
  for (let k = 0; k < SPOKES; k += 1) {
    const spoke = refs.svg.spokes[k];
    if (spoke) fade(ctx, spoke, 1, 0, 0, 0.3);
  }
  [0, 1, 2].forEach((i) => {
    const tile = refs.tiles[i];
    if (tile) fade(ctx, tile.hi, 1, 0, 0, 0.25);
  });

  // Luminance: dark in, always via the shared dissolve ease.
  fade(
    ctx,
    refs.veilDark,
    0,
    profile.darkLevel,
    LUMI.darkIn.at,
    LUMI.darkIn.duration,
    LUMINANCE_EASE,
  );

  const row = (i: number) => (i < info.shown ? rowIndexOf(info, i) : 0);
  moveTiles(ctx, fanPoses(geo, n), rowPoses(geo, n), {
    at: 0,
    dur: 0.75,
    ease: profile.ease.move,
    rank: (i) => (i % info.cols) + (row(i) === 1 ? 4 : 0),
    stagger: 0.012,
  });

  // The 3D turn: a full revolution about the vertical axis, rows staggered, row 1 trailing as the echo.
  for (let i = 0; i < info.shown; i += 1) {
    const tile = refs.tiles[i];
    if (!tile) continue;
    const echo = row(i) === 1;
    const at = 0.08 + (i % info.cols) * 0.012 + (echo ? 0.12 : 0);
    fromTo(
      ctx,
      tile.root,
      { rotationY: 0 },
      { rotationY: 360, duration: 0.62, ease: profile.ease.flip },
      at,
    );
    if (echo) {
      fade(ctx, tile.root, 1, 0.45, 0.1, 0.25);
      fade(ctx, tile.root, 0.45, 1, 0.7, 0.25);
    }
  }

  // Shadow streaks sweep horizontally.
  refs.streaks.forEach((streak, k) => {
    const y = geo.h * (0.25 + 0.25 * k);
    const at = 0.1 + k * 0.1;
    fromTo(
      ctx,
      streak,
      { x: -geo.w * 0.4, y, opacity: 0 },
      { x: geo.w * 0.2, opacity: 0.5, duration: 0.25, ease: "power2.in" },
      at,
    );
    fromTo(
      ctx,
      streak,
      { x: geo.w * 0.2, opacity: 0.5 },
      { x: geo.w * 1.2, opacity: 0, duration: 0.3, ease: "power2.out" },
      at + 0.25,
    );
  });
};
