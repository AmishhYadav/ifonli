"use client";

import * as React from "react";

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const DURATION_MS = 900;

/** easeOutExpo-like: quick start, long soft landing. */
function ease(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

interface Part {
  /** Text before this number (and any non-numeric tail on the last part). */
  prefix: string;
  target: number;
  decimals: number;
}

function parse(value: string): { parts: Part[]; tail: string } {
  const parts: Part[] = [];
  let last = 0;
  for (const m of value.matchAll(NUMBER)) {
    const raw = m[0];
    const index = m.index ?? 0;
    const decimals = raw.includes(".") ? (raw.split(".")[1]?.length ?? 0) : 0;
    parts.push({ prefix: value.slice(last, index), target: Number(raw.replace(/,/g, "")), decimals });
    last = index + raw.length;
  }
  return { parts, tail: value.slice(last) };
}

/**
 * Shows `value` (already formatted, e.g. "₹12,40,000" or "3 / 4") and counts its numbers up from zero
 * on first paint. The DOM text is the real value from the server render and settles on exactly that
 * string, so screen readers, tests and no-JS see the right number; under reduced motion it never moves.
 */
export function CountUp({ value, className }: { value: string; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { parts, tail } = parse(value);
    if (parts.length === 0 || parts.every((p) => p.target === 0)) return;

    const fmt = (n: number, decimals: number) =>
      new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(n);
    const render = (progress: number) =>
      parts.map((p) => p.prefix + fmt(p.target * progress, p.decimals)).join("") + tail;

    let raf = 0;
    const start = performance.now();
    node.nodeValue = render(0);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      node.nodeValue = t >= 1 ? value : render(ease(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      node.nodeValue = value;
    };
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}
