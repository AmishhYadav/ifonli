import { formationPoses, ringPoses, type Pose } from "../poses";

import { fade, fromTo, moveTiles, toggle, type SceneBuilder, type SceneCtx } from "./helpers";
import { ANCHOR, LINK } from "./static";

interface Step {
  /** Scene-local start of the snap. */
  at: number;
  links: number[];
  anchors: readonly number[];
}

const SNAP = 0.28;
const DRAW = 0.2;

function showConnectors(ctx: SceneCtx, step: Step): void {
  const { refs, profile } = ctx;
  const drawAt = step.at + SNAP - 0.04;
  for (const l of step.links) {
    const link = refs.svg.links[l];
    if (!link) continue;
    toggle(ctx, link, true, drawAt);
    fromTo(
      ctx,
      link,
      { drawSVG: "0%" },
      { drawSVG: "100%", duration: DRAW, ease: profile.ease.move },
      drawAt,
    );
  }
  step.anchors.forEach((idx, k) => {
    const anchor = refs.svg.anchors[idx];
    if (!anchor) return;
    const at = drawAt + DRAW * 0.6 + k * 0.02;
    toggle(ctx, anchor, true, at);
    fromTo(ctx, anchor, { scale: 0 }, { scale: 1, duration: 0.18, ease: profile.ease.pop }, at);
  });
}

function hideConnectors(ctx: SceneCtx, step: Step, at: number): void {
  for (const l of step.links) {
    const link = ctx.refs.svg.links[l];
    if (link) fade(ctx, link, 1, 0, at, 0.15);
  }
  for (const idx of step.anchors) {
    const anchor = ctx.refs.svg.anchors[idx];
    if (anchor) fade(ctx, anchor, 1, 0, at, 0.15);
  }
}

/** Scene 7 (1.4 s): snap into a cross, then a checkerboard, then a strip, with connector lines and anchor dots. */
export const scene07: SceneBuilder = (ctx) => {
  const { profile, geo, n } = ctx;
  const ring = ringPoses(geo, n);
  const cross = formationPoses(geo, "cross", n);
  const checker = formationPoses(geo, "checker", n);
  const strip = formationPoses(geo, "strip", n);

  const steps: { from: Pose[]; to: Pose[]; step: Step }[] = [
    {
      from: ring,
      to: cross,
      step: { at: 0, links: [LINK.crossH, LINK.crossV], anchors: ANCHOR.cross },
    },
    {
      from: cross,
      to: checker,
      step: { at: 0.45, links: [LINK.checker], anchors: ANCHOR.checker },
    },
    { from: checker, to: strip, step: { at: 0.9, links: [LINK.strip], anchors: ANCHOR.strip } },
  ];

  steps.forEach(({ from, to, step }, k) => {
    moveTiles(ctx, from, to, { at: step.at, dur: SNAP, ease: profile.ease.snap, stagger: 0.004 });
    showConnectors(ctx, step);
    const next = steps[k + 1];
    if (next) hideConnectors(ctx, step, next.step.at);
  });
};
