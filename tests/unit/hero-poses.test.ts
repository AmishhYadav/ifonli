import { describe, expect, it } from "vitest";

import { chainPath, connectorPath, rectPath, spokePath } from "@/features/hero/stage/connectors";
import {
  computeGeometry,
  layoutFor,
  syntheticCells,
  type Geometry,
} from "@/features/hero/stage/geometry";
import {
  FAN_TILES,
  SPOKES,
  denseInfo,
  formationPoints,
  gridPoses,
  hiddenAt,
  lerpPose,
  pose,
  rowsInfo,
  samePose,
  scenePoses,
  spokeEnd,
  swirlPoint,
  waveOrder,
  type Pose,
} from "@/features/hero/stage/poses";
import type { ConnectorStyle } from "@/features/hero/stage/profiles";
import { tileCountFor } from "@/features/hero/stage/tiles";

const wide = computeGeometry({ w: 1400, h: 420, layout: "wide" });
const stacked = computeGeometry({ w: 390, h: 640, layout: "stacked" });
const cases: [string, Geometry, number][] = [
  ["wide", wide, tileCountFor("wide")],
  ["stacked", stacked, tileCountFor("stacked")],
];

const finite = (p: Pose) => [p.x, p.y, p.s, p.r, p.ry, p.o].every(Number.isFinite);

describe("layout and geometry", () => {
  it("is wide from 1024 px and stacked below", () => {
    expect(layoutFor(1440)).toBe("wide");
    expect(layoutFor(1024)).toBe("wide");
    expect(layoutFor(1023)).toBe("stacked");
    expect(layoutFor(390)).toBe("stacked");
  });

  it("puts the pair in the lanes beside the card on wide, above the card when stacked", () => {
    expect(wide.pairA.x).toBeLessThan(wide.card!.x);
    expect(wide.pairB.x).toBeGreaterThan(wide.card!.x + wide.card!.w);
    expect(stacked.focus.h).toBeLessThanOrEqual(stacked.card!.y);
    expect(stacked.solo.y).toBeLessThan(stacked.card!.y);
  });

  it("synthesises poster cells like the poster grid: even tiles left, odd tiles right", () => {
    const cells = syntheticCells("wide", 1400, 420, wide.card);
    expect(cells).toHaveLength(8);
    cells.forEach((c, i) => {
      expect(c.size).toBeGreaterThan(40);
      if (i % 2 === 0) expect(c.x).toBeLessThan(wide.card!.x);
      else expect(c.x).toBeGreaterThan(wide.card!.x + wide.card!.w);
    });
    expect(syntheticCells("stacked", 390, 640, null)).toHaveLength(12);
  });

  it("prefers measured poster cells and takes the tile size from them", () => {
    const g = computeGeometry({
      w: 1400,
      h: 420,
      layout: "wide",
      cells: [{ x: 10, y: 10, size: 123 }],
    });
    expect(g.cells[0]).toEqual({ x: 10, y: 10, size: 123 });
    expect(g.unit).toBe(123);
  });
});

describe.each(cases)("scene poses (%s)", (_name, geo, n) => {
  it("gives every scene one finite pose per tile", () => {
    for (let id = 1; id <= 10; id += 1) {
      const poses = scenePoses(id, geo, n);
      expect(poses).toHaveLength(n);
      expect(poses.every(finite)).toBe(true);
    }
  });

  it("closes the loop: scene 10 ends exactly where scene 1 starts", () => {
    const a = scenePoses(10, geo, n);
    const b = scenePoses(1, geo, n);
    a.forEach((p, i) => expect(samePose(p, b[i]!)).toBe(true));
  });

  it("opens on one large tile and hides the rest", () => {
    const p = scenePoses(1, geo, n);
    expect(p[0]!.o).toBe(1);
    expect(p[0]!.s).toBeGreaterThan(1);
    expect(p.slice(1).every((x) => x.o === 0)).toBe(true);
  });

  it("splits into a pair, then fans out with two to three large heroes", () => {
    const pair = scenePoses(2, geo, n);
    expect(pair.filter((x) => x.o > 0)).toHaveLength(2);
    const fan = scenePoses(3, geo, n);
    const large = fan.filter((x) => x.o > 0 && x.s >= 1.2);
    expect(large.length).toBeGreaterThanOrEqual(2);
    expect(large.length).toBeLessThanOrEqual(3);
    expect(fan.filter((x) => x.o > 0)).toHaveLength(3 + FAN_TILES);
  });

  it("rests on the poster cells (scene 9), and hides tiles the poster does not show", () => {
    const grid = gridPoses(geo, n);
    grid.forEach((p, i) => {
      const cell = geo.cells[i];
      if (cell) {
        expect(p.x).toBeCloseTo(cell.x, 6);
        expect(p.y).toBeCloseTo(cell.y, 6);
        expect(p.s * geo.unit).toBeCloseTo(cell.size, 6);
        expect(p.o).toBe(1);
        expect(p.r).toBe(0);
      } else {
        expect(p.o).toBe(0);
      }
    });
    expect(scenePoses(9, geo, n)).toEqual(grid);
  });

  it("orders the highlight wave left to right over the visible cells only", () => {
    const order = waveOrder(geo, n);
    expect(order).toHaveLength(geo.cells.filter(Boolean).length);
    const xs = order.map((i) => geo.cells[i]!.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("keeps formations within the tile budget", () => {
    for (const kind of ["cross", "checker", "strip"] as const) {
      const pts = formationPoints(geo, kind, n);
      expect(pts.length).toBeGreaterThan(2);
      expect(pts.length).toBeLessThanOrEqual(n);
    }
    const info = rowsInfo(geo, n);
    expect(info.shown).toBeLessThanOrEqual(n);
    const dense = denseInfo(geo, n);
    expect(dense.rows * dense.cols).toBeGreaterThanOrEqual(n);
  });

  it("ends the burst scene with every tile invisible at the hub", () => {
    for (const p of scenePoses(8, geo, n)) {
      expect(p.o).toBe(0);
      expect(p.x).toBe(geo.hub.x);
      expect(p.y).toBe(geo.hub.y);
    }
  });

  it("spokes end on the focus ellipse", () => {
    for (let k = 0; k < SPOKES; k += 1) {
      const e = spokeEnd(geo, k);
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(geo.w);
    }
  });
});

describe("pose helpers", () => {
  it("interpolates and compares poses", () => {
    const a = pose({ x: 0, y: 0 }, 1, 0, 0);
    const b = pose({ x: 100, y: 50 }, 3, 90, 1);
    expect(lerpPose(a, b, 0.5)).toMatchObject({ x: 50, y: 25, s: 2, r: 45, o: 0.5 });
    expect(samePose(a, lerpPose(a, b, 0))).toBe(true);
    expect(samePose(a, b)).toBe(false);
    expect(hiddenAt({ x: 1, y: 2 }).o).toBe(0);
  });

  it("swirls in polar coordinates from start to end, with the radius interpolating", () => {
    const hub = { x: 100, y: 100 };
    const from = { x: 200, y: 100 };
    const to = { x: 100, y: 40 };
    const start = swirlPoint(from, to, hub, 0);
    const end = swirlPoint(from, to, hub, 1);
    expect(start.x).toBeCloseTo(from.x, 6);
    expect(start.y).toBeCloseTo(from.y, 6);
    expect(end.x).toBeCloseTo(to.x, 6);
    expect(end.y).toBeCloseTo(to.y, 6);
    const mid = swirlPoint(from, to, hub, 0.5);
    expect(Math.hypot(mid.x - hub.x, mid.y - hub.y)).toBeCloseTo((100 + 60) / 2, 6);
  });
});

describe("connector paths", () => {
  const styles: ConnectorStyle[] = ["curve", "blocky", "scribble", "thin", "wave"];
  const a = { x: 10, y: 20 };
  const b = { x: 310, y: 120 };

  it.each(styles)("%s starts at a, ends at b and is deterministic", (style) => {
    const d = connectorPath(style, a, b, 4);
    expect(d.startsWith("M10 20")).toBe(true);
    expect(d).toBe(connectorPath(style, a, b, 4));
    // The block style ends with an axis-aligned run (H310) after reaching y = 120.
    expect(d).toMatch(style === "blocky" ? /V120H310$/ : /310 120$/);
  });

  it("scribbles differ by seed; chained paths contain a single move", () => {
    expect(connectorPath("scribble", a, b, 1)).not.toBe(connectorPath("scribble", a, b, 2));
    const chain = chainPath("curve", [a, b, { x: 500, y: 20 }]);
    expect(chain.match(/M/g)).toHaveLength(1);
    expect(chainPath("curve", [a])).toBe("");
    expect(spokePath(a, b)).toBe("M10 20L310 120");
    expect(rectPath({ x: 50, y: 50 }, 20, 10)).toBe("M40 45H60V55H40Z");
  });
});
