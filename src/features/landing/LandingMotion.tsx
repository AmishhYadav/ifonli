"use client";

import "lenis/dist/lenis.css";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";

import { DISPLAY_FONT_LOAD, VIBES } from "@/features/vibe/config";

const STORE = "/home";
const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * Starts the landing choreography after hydration (renders nothing). The page works without it: this adds
 * the sticky/scrubbed layout, Lenis and the auto hand-off, and tears all of it down on unmount so /home has
 * plain native scroll. Reduced motion never starts it (and stopping/starting follows the setting live).
 */
export function LandingMotion() {
  const router = useRouter();

  // A fresh visit, and Back from the store, both start at the top with the browser's own restoration off:
  // the page must never open half scrolled (or past the end, which would hand off again). The exception is a
  // visitor who started scrolling before hydration finished (a slow phone): Boot.tsx marked that gesture, and
  // yanking them back to the top would be worse than where they are.
  useLayoutEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    if (!document.getElementById("landing")?.dataset.gesture) window.scrollTo(0, 0);
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    const root = document.getElementById("landing");
    if (!root) return;

    const mql = window.matchMedia(REDUCED);
    let stop: (() => void) | undefined;
    let cancelled = false;
    let run = 0;

    const apply = () => {
      const mine = ++run;
      stop?.();
      stop = undefined;
      if (mql.matches) {
        delete root.dataset.motion;
        return;
      }
      root.dataset.motion = "on";
      void import("./motion").then(({ startLandingMotion }) => {
        if (cancelled || mine !== run) return;
        stop = startLandingMotion({
          root,
          fontDescriptors: VIBES.map((v) => DISPLAY_FONT_LOAD[v]),
          onEnter: () => router.push(STORE),
        });
      });
    };
    apply();
    mql.addEventListener("change", apply);

    // Warm the store when the portal is about to appear, and on intent for the plain links.
    const prefetch = () => router.prefetch(STORE);
    const portal = root.querySelector("[data-portal]");
    const observer =
      portal && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((e) => e.isIntersecting)) {
                prefetch();
                observer?.disconnect();
              }
            },
            { rootMargin: "100% 0px" },
          )
        : null;
    if (portal) observer?.observe(portal);
    const links = Array.from(document.querySelectorAll("[data-prefetch-intent]"));
    for (const link of links) {
      link.addEventListener("pointerenter", prefetch, { once: true });
      link.addEventListener("focus", prefetch, { once: true });
      link.addEventListener("touchstart", prefetch, { once: true, passive: true });
    }

    return () => {
      cancelled = true;
      run += 1;
      mql.removeEventListener("change", apply);
      stop?.();
      observer?.disconnect();
      for (const link of links) {
        link.removeEventListener("pointerenter", prefetch);
        link.removeEventListener("focus", prefetch);
        link.removeEventListener("touchstart", prefetch);
      }
    };
  }, [router]);

  return null;
}
