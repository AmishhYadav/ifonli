/** DOM handles of the stage, collected once from the markup rendered by `HeroStageView`. */

export interface TileRefs {
  root: HTMLAnchorElement;
  img: HTMLImageElement;
  /** Backing layers: square, rounded, circle, and the highlight ring. Cross-dissolved, never resized. */
  sq: HTMLElement;
  rd: HTMLElement;
  ci: HTMLElement;
  hi: HTMLElement;
}

export interface StageRefs {
  stage: HTMLElement;
  /** Everything except the controls: the profile dissolve fades this. */
  content: HTMLElement;
  canvas: HTMLElement;
  veilDark: HTMLElement;
  veilSolid: HTMLElement;
  glow: HTMLElement;
  tilesLayer: HTMLElement;
  tiles: TileRefs[];
  badges: HTMLElement[];
  streaks: HTMLElement[];
  sils: HTMLElement[];
  svg: {
    root: SVGSVGElement;
    selection: SVGPathElement;
    handles: SVGCircleElement[];
    spokes: SVGPathElement[];
    links: SVGPathElement[];
    anchors: SVGCircleElement[];
  };
}

/** Pool sizes the markup must provide. */
export const POOL = {
  handles: 8,
  spokes: 12,
  links: 5,
  anchors: 16,
  sils: 12,
  badges: 2,
  streaks: 3,
} as const;

function one<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`HeroStage: missing ${selector}`);
  return el;
}
function all<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function collectRefs(stage: HTMLElement): StageRefs {
  const tiles = all<HTMLAnchorElement>(stage, "[data-stage-tile]").map((root) => ({
    root,
    img: one<HTMLImageElement>(root, "img"),
    sq: one<HTMLElement>(root, '[data-layer="sq"]'),
    rd: one<HTMLElement>(root, '[data-layer="rd"]'),
    ci: one<HTMLElement>(root, '[data-layer="ci"]'),
    hi: one<HTMLElement>(root, '[data-layer="hi"]'),
  }));
  return {
    stage,
    content: one(stage, "[data-stage-content]"),
    canvas: one(stage, "[data-stage-canvas]"),
    veilDark: one(stage, '[data-stage-veil="dark"]'),
    veilSolid: one(stage, '[data-stage-veil="solid"]'),
    glow: one(stage, "[data-stage-glow]"),
    tilesLayer: one(stage, "[data-stage-tiles]"),
    tiles,
    badges: all(stage, "[data-stage-badge]"),
    streaks: all(stage, "[data-stage-streak]"),
    sils: all(stage, "[data-stage-sil]"),
    svg: {
      root: one<SVGSVGElement>(stage, "[data-stage-svg]"),
      selection: one<SVGPathElement>(stage, '[data-svg="selection"]'),
      handles: all<SVGCircleElement>(stage, '[data-svg="handle"]'),
      spokes: all<SVGPathElement>(stage, '[data-svg="spoke"]'),
      links: all<SVGPathElement>(stage, '[data-svg="link"]'),
      anchors: all<SVGCircleElement>(stage, '[data-svg="anchor"]'),
    },
  };
}
