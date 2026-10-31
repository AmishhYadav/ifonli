import { SOLO_SCALE } from "../poses";

import { fade, fromTo, toggle, type SceneBuilder } from "./helpers";

/** Scene 1 (1.2 s): one tile on a design-tool canvas: paper texture, grid, selection frame, handles. */
export const scene01: SceneBuilder = (ctx) => {
  const { refs, profile } = ctx;
  const tile = refs.tiles[0]?.root;
  if (!tile) return;

  // The selection frame draws itself around the tile, then the eight handles pop in.
  toggle(ctx, refs.svg.selection, true, 0.05);
  fromTo(
    ctx,
    refs.svg.selection,
    { drawSVG: "0%" },
    { drawSVG: "100%", duration: 0.55, ease: profile.ease.move },
    0.05,
  );
  refs.svg.handles.forEach((handle, i) => {
    const at = 0.55 + i * 0.045;
    toggle(ctx, handle, true, at);
    fromTo(ctx, handle, { scale: 0 }, { scale: 1, duration: 0.25, ease: profile.ease.pop }, at);
  });

  // The tile gives a small pulse as if grabbed.
  fromTo(
    ctx,
    tile,
    { scale: SOLO_SCALE },
    { scale: SOLO_SCALE * 1.08, duration: 0.2, ease: profile.ease.pop },
    0.3,
  );
  fromTo(
    ctx,
    tile,
    { scale: SOLO_SCALE * 1.08 },
    { scale: SOLO_SCALE, duration: 0.35, ease: profile.ease.settle },
    0.5,
  );

  // The canvas is fully there from the start (scene 10 fades it in); keep it explicit for seeking.
  fade(ctx, refs.canvas, 1, 1, 0, 0.001);
};
