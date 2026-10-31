import { LUMINANCE_EASE } from "../eases";
import { LUMI } from "../flash";
import { COLLAGE_ZOOM, densePoses, rowPoses } from "../poses";

import { fade, fromTo, moveTiles, toggle, type SceneBuilder } from "./helpers";

/**
 * Scene 5 (1.2 s): a dense collage zooms to fill the stage, then cross-dissolves to a solid vibe colour with
 * the vibe badge. The colour layer sits above the tiles; the dark layer under them dissolves out beneath it.
 */
export const scene05: SceneBuilder = (ctx) => {
  const { refs, profile, geo, n } = ctx;

  moveTiles(ctx, rowPoses(geo, n), densePoses(geo, n), {
    at: 0,
    dur: 0.5,
    ease: profile.ease.settle,
    stagger: 0.006,
  });

  fromTo(
    ctx,
    refs.tilesLayer,
    { scale: 1 },
    { scale: COLLAGE_ZOOM, duration: 0.65, ease: "power2.in" },
    0.1,
  );

  // Dark to colour: the colour layer fades in; the dark layer leaves beneath it (Gothic keeps it until covered).
  fade(ctx, refs.veilSolid, 0, 1, LUMI.toColour.at, LUMI.toColour.duration, LUMINANCE_EASE);
  if (profile.throughBlack) {
    toggle(ctx, refs.veilDark, false, LUMI.toColour.at + LUMI.toColour.duration);
  } else {
    fade(
      ctx,
      refs.veilDark,
      profile.darkLevel,
      0,
      LUMI.toColour.at,
      LUMI.toColour.duration,
      LUMINANCE_EASE,
    );
  }

  // The vibe badge pops in on the solid colour.
  refs.badges.forEach((badge, k) => {
    const at = 0.85 + k * 0.05;
    fromTo(
      ctx,
      badge,
      { opacity: 0, scale: 0.4 },
      { opacity: 1, scale: 1, duration: 0.3, ease: profile.ease.pop },
      at,
    );
  });
};
