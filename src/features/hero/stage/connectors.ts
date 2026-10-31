/** SVG path builders for the connector lines, one drawing style per motion profile. Deterministic. */
import { hash01 } from "./eases";
import type { Pt } from "./geometry";
import type { ConnectorStyle } from "./profiles/types";

const f = (n: number): string => (Math.round(n * 10) / 10).toString();

const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Path from `a` to `b` in the given style. Always starts at `a` and ends at `b`. */
export function connectorPath(style: ConnectorStyle, a: Pt, b: Pt, seed = 0): string {
  const len = Math.max(1, dist(a, b));
  const nx = -(b.y - a.y) / len; // unit normal
  const ny = (b.x - a.x) / len;

  switch (style) {
    case "curve": {
      const off = len * 0.14;
      const cx = (a.x + b.x) / 2 + nx * off;
      const cy = (a.y + b.y) / 2 + ny * off;
      return `M${f(a.x)} ${f(a.y)}Q${f(cx)} ${f(cy)} ${f(b.x)} ${f(b.y)}`;
    }
    case "thin": {
      const off = len * 0.05;
      const cx = (a.x + b.x) / 2 + nx * off;
      const cy = (a.y + b.y) / 2 + ny * off;
      return `M${f(a.x)} ${f(a.y)}Q${f(cx)} ${f(cy)} ${f(b.x)} ${f(b.y)}`;
    }
    case "blocky": {
      const mx = (a.x + b.x) / 2;
      return `M${f(a.x)} ${f(a.y)}H${f(mx)}V${f(b.y)}H${f(b.x)}`;
    }
    case "scribble": {
      // A hand-drawn double stroke: out with jitter, back with a different jitter, then settle on b.
      const steps = Math.max(6, Math.min(18, Math.round(len / 24)));
      const pts: string[] = [`M${f(a.x)} ${f(a.y)}`];
      for (let i = 1; i < steps; i += 1) {
        const t = i / steps;
        const j = (hash01(seed * 31 + i, 7) - 0.5) * 12;
        pts.push(`L${f(a.x + (b.x - a.x) * t + nx * j)} ${f(a.y + (b.y - a.y) * t + ny * j)}`);
      }
      for (let i = steps - 1; i >= Math.floor(steps / 2); i -= 1) {
        const t = i / steps;
        const j = (hash01(seed * 17 + i, 11) - 0.5) * 9;
        pts.push(`L${f(a.x + (b.x - a.x) * t + nx * j)} ${f(a.y + (b.y - a.y) * t + ny * j)}`);
      }
      pts.push(`L${f(b.x)} ${f(b.y)}`);
      return pts.join("");
    }
    case "wave": {
      const samples = Math.max(12, Math.min(40, Math.round(len / 10)));
      const amp = Math.min(18, len * 0.07);
      const periods = Math.max(1.5, Math.min(4, len / 140));
      const pts: string[] = [`M${f(a.x)} ${f(a.y)}`];
      for (let i = 1; i < samples; i += 1) {
        const t = i / samples;
        const w = Math.sin(t * periods * 2 * Math.PI) * amp * Math.sin(Math.PI * t);
        pts.push(`L${f(a.x + (b.x - a.x) * t + nx * w)} ${f(a.y + (b.y - a.y) * t + ny * w)}`);
      }
      pts.push(`L${f(b.x)} ${f(b.y)}`);
      return pts.join("");
    }
  }
}

/** One path through several points, each hop drawn in the profile's style. */
export function chainPath(style: ConnectorStyle, points: readonly Pt[], seed = 0): string {
  if (points.length < 2) return "";
  let d = "";
  for (let i = 0; i < points.length - 1; i += 1) {
    const seg = connectorPath(style, points[i]!, points[i + 1]!, seed + i);
    // Every segment but the first continues from the previous end: drop its leading "M x y".
    d += i === 0 ? seg : seg.replace(/^M[^A-Za-z]+/, "");
  }
  return d;
}

/** Straight spoke from the hub out to a point. */
export function spokePath(hub: Pt, to: Pt): string {
  return `M${f(hub.x)} ${f(hub.y)}L${f(to.x)} ${f(to.y)}`;
}

/** Closed rectangle path centred on `c` (the selection frame of scene 1). */
export function rectPath(c: Pt, w: number, h: number): string {
  const x = c.x - w / 2;
  const y = c.y - h / 2;
  return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
}
