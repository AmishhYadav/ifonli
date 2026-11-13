"use client";

import * as React from "react";

const TILT_DEG = 5;

/**
 * One delegated pointer listener for the whole admin (no per-card handlers):
 *  - `[data-glow]` surfaces get `--mx` / `--my` (the cursor position inside them) for the spotlight;
 *  - `[data-tilt]` surfaces also get a small 3D tilt (`--rx` / `--ry`) that eases back on leave;
 *  - the ambient backdrop drifts a few pixels against the cursor (`--px` / `--py`).
 * Mouse and pen only, never touch, and nothing runs under `prefers-reduced-motion`. Renders nothing.
 */
export function PointerFx() {
  React.useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduced.matches) return;

    const ambient = document.querySelector<HTMLElement>("[data-ambient]");
    let frame = 0;
    let last: PointerEvent | null = null;
    let active: HTMLElement | null = null;

    const reset = (el: HTMLElement) => {
      el.style.removeProperty("--rx");
      el.style.removeProperty("--ry");
    };

    const apply = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      if (ambient) {
        ambient.style.setProperty("--px", String(e.clientX / window.innerWidth - 0.5));
        ambient.style.setProperty("--py", String(e.clientY / window.innerHeight - 0.5));
      }
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-glow]") : null;
      if (active && active !== target) {
        reset(active);
        active = null;
      }
      if (!target) return;
      active = target;
      const box = target.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      target.style.setProperty("--mx", `${x}px`);
      target.style.setProperty("--my", `${y}px`);
      if (target.hasAttribute("data-tilt")) {
        target.style.setProperty("--rx", `${((x / box.width - 0.5) * TILT_DEG * 2).toFixed(2)}deg`);
        target.style.setProperty("--ry", `${((0.5 - y / box.height) * TILT_DEG * 2).toFixed(2)}deg`);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      if (active) reset(active);
      active = null;
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
      if (active) reset(active);
    };
  }, []);

  return null;
}
