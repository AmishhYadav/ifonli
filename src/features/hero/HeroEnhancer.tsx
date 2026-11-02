"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import type { Vibe } from "@/features/vibe/config";
import { getVibe } from "@/features/vibe/store";

import { emitHeroEvent } from "./stage/analytics";
import { readEnv, shouldEnhance } from "./stage/eligibility";
import type { StageTile } from "./stage/tiles";

// The animation (GSAP, scenes, profiles) lives in this chunk and is requested only after the checks below pass.
const HeroStage = dynamic(() => import("./stage/HeroStage"), { ssr: false });

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 300);
  return () => window.clearTimeout(id);
}

/**
 * How long after the page has loaded the stage waits, if the visitor has not touched the page by then. The stage
 * starts on the poster's own rest frame, so the hand-over is invisible, and the first seconds of the page (hydration,
 * the first taps) keep the main thread to themselves.
 */
const SETTLE_MS = 2500;
const INPUT_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;

/** Runs `run` once the page has loaded and either the visitor interacted or `SETTLE_MS` passed, then at idle. */
function whenSettled(run: () => void): () => void {
  let cancelIdle: (() => void) | null = null;
  let timer = 0;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    detach();
    cancelIdle = whenIdle(run);
  };
  const arm = () => {
    if (started) return;
    timer = window.setTimeout(start, SETTLE_MS);
    for (const type of INPUT_EVENTS) window.addEventListener(type, start, { passive: true, once: true });
  };
  const detach = () => {
    window.clearTimeout(timer);
    window.removeEventListener("load", arm);
    for (const type of INPUT_EVENTS) window.removeEventListener(type, start);
  };
  if (document.readyState === "complete") arm();
  else window.addEventListener("load", arm, { once: true });
  return () => {
    started = true;
    detach();
    cancelIdle?.();
  };
}

/**
 * Progressive enhancement of the static poster (plan section 9). Mounted inside `#hero-stage-root`.
 * It loads the animated stage only when the hero is in the viewport, once the page has loaded and settled (first
 * input or a short delay, then an idle callback), and never on reduced motion, data saver, a 2g-class connection or
 * low-end hardware. It also reports `hero_impression` and poster tile
 * clicks through the analytics adapter (`stage/analytics.ts`).
 */
export function HeroEnhancer({ tiles }: { tiles: Record<Vibe, StageTile[]> }) {
  const [load, setLoad] = useState(false);
  const animated = useRef(false);
  useEffect(() => {
    animated.current = load;
  }, [load]);

  useEffect(() => {
    const section = document.querySelector<HTMLElement>("[data-hero]");
    if (!section) return;

    // --- Lazy enhancement -------------------------------------------------------------------------
    let cancelIdle: (() => void) | null = null;
    let visibleObserver: IntersectionObserver | null = null;

    const stop = () => {
      cancelIdle?.();
      cancelIdle = null;
      visibleObserver?.disconnect();
      visibleObserver = null;
    };
    const arm = () => {
      stop();
      if (!shouldEnhance(readEnv())) return;
      if (typeof IntersectionObserver === "undefined") return;
      visibleObserver = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        visibleObserver?.disconnect();
        cancelIdle = whenSettled(() => {
          // Re-check at the moment of loading: the visitor may have switched to reduced motion meanwhile.
          if (shouldEnhance(readEnv())) setLoad(true);
        });
      });
      visibleObserver.observe(section);
    };
    arm();

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => {
      if (mq.matches) {
        stop();
        setLoad(false); // unmounts the stage: the poster is all that remains
      } else {
        arm();
      }
    };
    mq.addEventListener("change", onMotionChange);

    // --- Impression: at least half the hero visible for one second, once ---------------------------
    let impressionTimer: number | null = null;
    let impressed = false;
    const impressionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible && !impressed && impressionTimer === null) {
          impressionTimer = window.setTimeout(() => {
            impressed = true;
            impressionObserver.disconnect();
            emitHeroEvent("hero_impression", { vibe: getVibe(), animated: animated.current });
          }, 1000);
        } else if (!visible && impressionTimer !== null) {
          window.clearTimeout(impressionTimer);
          impressionTimer = null;
        }
      },
      { threshold: 0.5 },
    );
    impressionObserver.observe(section);

    // --- Poster tile clicks (stage tiles report their own) ------------------------------------------
    const onClick = (e: MouseEvent) => {
      const link =
        e.target instanceof Element ? e.target.closest<HTMLElement>("a[data-hero-tile]") : null;
      const item = link?.closest<HTMLElement>("[data-poster-i]");
      if (!link || !item) return;
      emitHeroEvent("hero_tile_click", {
        slug: link.dataset.heroTile ?? "",
        position: Number(item.dataset.posterI ?? -1),
        vibe: getVibe(),
        animated: false,
      });
    };
    section.addEventListener("click", onClick);

    return () => {
      stop();
      mq.removeEventListener("change", onMotionChange);
      impressionObserver.disconnect();
      if (impressionTimer !== null) window.clearTimeout(impressionTimer);
      section.removeEventListener("click", onClick);
    };
  }, []);

  return load ? <HeroStage tiles={tiles} /> : null;
}
