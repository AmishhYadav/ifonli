"use client";

import { useEffect, type RefObject } from "react";

/**
 * While the phone add bar (fixed to the bottom edge, see StockControls) is mounted, publish its height as
 * `--toast-bottom` on <html>. The toast region sits above the bar instead of on top of it, and store.css pads the
 * page's end by the same amount so the footer is never hidden behind the bar. Nothing is published from `md` up,
 * where the bar is an ordinary row. The height is observed (safe area, font size, stepper), not guessed.
 */
export function useStickyBarOffset(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = document.documentElement;
    const mobile = window.matchMedia("(max-width: 767.98px)");
    const update = () => {
      const el = ref.current;
      if (!el || !mobile.matches) {
        root.style.removeProperty("--toast-bottom");
        return;
      }
      root.style.setProperty("--toast-bottom", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    };
    update();
    mobile.addEventListener("change", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (ref.current) observer?.observe(ref.current);
    return () => {
      mobile.removeEventListener("change", update);
      observer?.disconnect();
      root.style.removeProperty("--toast-bottom");
    };
  }, [ref]);
}
