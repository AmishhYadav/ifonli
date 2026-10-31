import { hash01 } from "../eases";
import { formationPoses, implodePoses } from "../poses";

import { fade, fromTo, moveTiles, rankByDistance, type SceneBuilder } from "./helpers";
import { ANCHOR, LINK } from "./static";

const TAU = Math.PI * 2;

/**
 * Scene 8 (0.8 s): product-silhouette burst (replaces the reference's brush strokes, decision C-15). The
 * tiles gather into the hub and the silhouettes of the products fly out in the vibe's colours.
 */
export const scene08: SceneBuilder = (ctx) => {
  const { refs, profile, geo, n } = ctx;

  // Strip connector and dots leave.
  const link = refs.svg.links[LINK.strip];
  if (link) fade(ctx, link, 1, 0, 0, 0.2);
  for (const idx of ANCHOR.strip) {
    const anchor = refs.svg.anchors[idx];
    if (anchor) fade(ctx, anchor, 1, 0, 0, 0.2);
  }

  const strip = formationPoses(geo, "strip", n);
  const implode = implodePoses(geo, n);
  moveTiles(ctx, strip, implode, {
    at: 0,
    dur: 0.32,
    ease: profile.ease.move,
    rank: rankByDistance(strip, geo.hub),
    stagger: 0.004,
    straight: true,
  });

  // The silhouettes: each bursts outward on its own ray, growing and fading (opacity ramps are >= 200 ms).
  const count = Math.min(profile.burstCount, refs.sils.length);
  for (let k = 0; k < count; k += 1) {
    const sil = refs.sils[k]!;
    const angle = (k / count) * TAU + hash01(k, 21) * 0.5;
    const reach = Math.min(geo.w, geo.h * 1.6) * (0.28 + hash01(k, 22) * 0.2);
    const tx = geo.hub.x + Math.cos(angle) * reach * (geo.layout === "wide" ? 2.2 : 1);
    const ty = geo.hub.y + Math.sin(angle) * reach * (geo.layout === "wide" ? 0.9 : 1);
    const spin = (hash01(k, 23) - 0.5) * 120;
    fromTo(
      ctx,
      sil,
      { x: geo.hub.x, y: geo.hub.y, scale: 0.2, rotation: 0 },
      {
        x: tx,
        y: ty,
        scale: 1.1 + hash01(k, 24) * 0.9,
        rotation: spin,
        duration: 0.5,
        ease: profile.ease.pop,
      },
      0.25,
    );
    fade(ctx, sil, 0, 1, 0.2, 0.2);
    fade(ctx, sil, 1, 0, 0.45, 0.35);
  }

  // The design canvas dissolves away as the grid takes over.
  fade(ctx, refs.canvas, 1, 0, 0.3, 0.5);
};
