import { fanPoses, pairPoses, SPOKES } from "../poses";

import { fade, fromTo, moveTiles, toggle, type SceneBuilder } from "./helpers";
import { ANCHOR, LINK } from "./static";

/** Scene 3 (1.4 s): small tiles fan out on spokes; two to three large highlighted hero tiles. */
export const scene03: SceneBuilder = (ctx) => {
  const { refs, profile, geo, n } = ctx;

  // The pair connector and its dots leave.
  const link = refs.svg.links[LINK.pair];
  if (link) fade(ctx, link, 1, 0, 0, 0.25);
  ANCHOR.pair.forEach((idx) => {
    const anchor = refs.svg.anchors[idx];
    if (anchor) fade(ctx, anchor, 1, 0, 0, 0.25);
  });

  // Spokes radiate from the hub.
  for (let k = 0; k < SPOKES; k += 1) {
    const spoke = refs.svg.spokes[k];
    if (!spoke) continue;
    const at = 0.05 + k * 0.02;
    toggle(ctx, spoke, true, at);
    fromTo(
      ctx,
      spoke,
      { drawSVG: "0%" },
      { drawSVG: "100%", duration: 0.55, ease: profile.ease.move },
      at,
    );
  }

  moveTiles(ctx, pairPoses(geo, n), fanPoses(geo, n), {
    at: 0.1,
    dur: 1.1,
    ease: profile.ease.move,
    rank: (i) => (i < 3 ? 0 : i - 2),
  });

  // The big ones are highlighted with the ring layer.
  [0, 1, 2].forEach((i) => {
    const tile = refs.tiles[i];
    if (tile) fade(ctx, tile.hi, 0, 1, 0.95, 0.3);
  });
};
