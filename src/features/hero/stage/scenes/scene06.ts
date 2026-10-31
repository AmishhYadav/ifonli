import { LUMINANCE_EASE } from "../eases";
import { LUMI } from "../flash";
import {
  COLLAGE_ZOOM,
  densePoses,
  lerp,
  ringPoses,
  scatterPoses,
  spiralPoses,
  swirlPoint,
} from "../poses";

import { fade, fromTo, moveTiles, toggle, type SceneBuilder } from "./helpers";

/** Scene 6 (1.4 s): scatter, then swirl into a spiral, then settle into ring clusters. */
export const scene06: SceneBuilder = (ctx) => {
  const { refs, profile, geo, n } = ctx;

  // Reset the zoom while the solid colour still covers everything.
  fromTo(ctx, refs.tilesLayer, { scale: COLLAGE_ZOOM }, { scale: 1, duration: 0.001 }, 0);
  refs.badges.forEach((badge) => fade(ctx, badge, 1, 0, 0.05, 0.2));
  fade(ctx, refs.veilSolid, 1, 0, LUMI.colourOut.at, LUMI.colourOut.duration, LUMINANCE_EASE);
  if (profile.throughBlack) toggle(ctx, refs.veilDark, false, 0);

  const dense = densePoses(geo, n);
  const scatter = scatterPoses(geo, n);
  const spiral = spiralPoses(geo, n);
  const ring = ringPoses(geo, n);

  moveTiles(ctx, dense, scatter, { at: 0, dur: 0.45, ease: profile.ease.move, stagger: 0.004 });

  // Swirl: positions interpolate in polar coordinates about the hub (a full turn), so the tiles spiral in.
  const progress = { p: 0 };
  const apply = (p: number) => {
    for (let i = 0; i < n; i += 1) {
      const a = scatter[i]!;
      const b = spiral[i]!;
      const pt = swirlPoint(a, b, geo.hub, p, 1);
      ctx.gsap.set(refs.tiles[i]!.root, {
        x: pt.x,
        y: pt.y,
        scale: lerp(a.s, b.s, p),
        rotation: lerp(a.r, b.r, p),
        opacity: lerp(a.o, b.o, p),
      });
    }
  };
  ctx.tl.fromTo(
    progress,
    { p: 0 },
    {
      p: 1,
      duration: 0.55,
      ease: profile.ease.move,
      immediateRender: false,
      onUpdate: () => apply(progress.p),
      onReverseComplete: () => apply(0),
    },
    ctx.t0 + 0.45,
  );

  moveTiles(ctx, spiral, ring, { at: 1.0, dur: 0.4, ease: profile.ease.settle, stagger: 0.006 });
};
