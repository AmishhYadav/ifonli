"use client";

import { useEffect, type RefObject } from "react";

/**
 * While the mobile sticky add bar is on screen, publish how much of the viewport bottom it covers as
 * `--toast-bottom` on <html>, so the toast region sits above it instead of on top of it. The bar can scroll
 * out of view (it only sticks while the details are visible), so the value follows scroll and resize.
 */
export function useStickyBarOffset(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = document.documentElement;
    const mobile = window.matchMedia("(max-width: 767.98px)");
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el || !mobile.matches) {
          root.style.removeProperty("--toast-bottom");
          return;
        }
        const rect = el.getBoundingClientRect();
        const covered = rect.bottom > 0 && rect.top < window.innerHeight ? window.innerHeight - rect.top : 0;
        if (covered > 0) root.style.setProperty("--toast-bottom", `${Math.round(covered)}px`);
        else root.style.removeProperty("--toast-bottom");
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    mobile.addEventListener("change", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (ref.current) observer?.observe(ref.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      mobile.removeEventListener("change", update);
      observer?.disconnect();
      root.style.removeProperty("--toast-bottom");
    };
  }, [ref]);
}
