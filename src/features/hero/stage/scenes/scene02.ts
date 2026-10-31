import { openingPoses, pairPoses } from "../poses";

import { fade, fromTo, moveTiles, toggle, type SceneBuilder } from "./helpers";
import { ANCHOR, LINK } from "./static";

/** Scene 2 (1.2 s): the tile splits into a pair with a connector; the frame morphs square, rounded, circle. */
export const scene02: SceneBuilder = (ctx) => {
  const { refs, profile, geo, n } = ctx;

  // Selection frame and handles leave.
  fade(ctx, refs.svg.selection, 1, 0, 0, 0.3);
  refs.svg.handles.forEach((handle) => fade(ctx, handle, 1, 0, 0, 0.3));

  moveTiles(ctx, openingPoses(geo, n), pairPoses(geo, n), {
    at: 0.1,
    dur: 0.75,
    ease: profile.ease.move,
    stagger: 0.06,
  });

  // Frame morph, cross-dissolved (opacity only): square to rounded, then rounded to circle.
  [0, 1].forEach((i) => {
    const tile = refs.tiles[i];
    if (!tile) return;
    const delay = i * 0.07;
    fade(ctx, tile.sq, 1, 0, 0.1 + delay, 0.35);
    fade(ctx, tile.rd, 0, 1, 0.1 + delay, 0.35);
    fade(ctx, tile.rd, 1, 0, 0.6 + delay, 0.35);
    fade(ctx, tile.ci, 0, 1, 0.6 + delay, 0.35);
  });

  // Connector between the pair, drawn in the profile's style, with anchor dots at both ends.
  const link = refs.svg.links[LINK.pair];
  if (link) {
    toggle(ctx, link, true, 0.45);
    fromTo(
      ctx,
      link,
      { drawSVG: "0%" },
      { drawSVG: "100%", duration: 0.55, ease: profile.ease.move },
      0.45,
    );
  }
  ANCHOR.pair.forEach((idx, k) => {
    const anchor = refs.svg.anchors[idx];
    if (!anchor) return;
    toggle(ctx, anchor, true, 0.8 + k * 0.05);
    fromTo(
      ctx,
      anchor,
      { scale: 0 },
      { scale: 1, duration: 0.25, ease: profile.ease.pop },
      0.8 + k * 0.05,
    );
  });
};
