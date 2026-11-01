"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_VIBE_CYCLE,
  DISPLAY_FONT_LOAD,
  VIBES,
  VIBE_NAMES,
  handUrl,
  nextVibe,
  textureUrl,
  type Vibe,
} from "./config";
import { getVibe, setVibe } from "./store";
import { useVibe } from "./useVibe";

const FONT_WAIT_MS = 120;
const LONG_PRESS_MS = 500;
const TIP_HOLD_MS = 1600;

const warmed = new Set<Vibe>();

/** Idle-time warm-up of a vibe's display font, texture and hand art (so the NEXT switch needs no network). */
function warm(vibe: Vibe): void {
  if (warmed.has(vibe)) return;
  warmed.add(vibe);
  document.fonts?.load(DISPLAY_FONT_LOAD[vibe]).catch(() => {});
  new Image().src = textureUrl(vibe);
  new Image().src = handUrl(vibe);
}

function whenIdle(callback: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 1500 });
  } else {
    window.setTimeout(callback, 600);
  }
}

function fontReady(vibe: Vibe): Promise<unknown> {
  if (!document.fonts) return Promise.resolve();
  return Promise.race([
    document.fonts.load(DISPLAY_FONT_LOAD[vibe]).catch(() => {}),
    new Promise((resolve) => window.setTimeout(resolve, FONT_WAIT_MS)),
  ]);
}

interface Props {
  /** Cycle order (later phases pass settings.vibe_cycle). */
  cycle?: readonly Vibe[];
  className?: string;
}

/**
 * The vibe switcher. All five hand glyphs and names are in the markup; CSS shows the active one
 * (flags in tokens/*.css), so the label is right before hydration. Plan section 8.4.
 */
export function HandButton({ cycle = DEFAULT_VIBE_CYCLE, className = "" }: Props) {
  const { vibe } = useVibe();
  const next = nextVibe(vibe, cycle);
  const [tipOpen, setTipOpen] = useState(false);
  const [flick, setFlick] = useState(false);
  const target = useRef<Vibe | null>(null);
  const pressTimer = useRef<number>(0);
  const tipTimer = useRef<number>(0);
  const flickTimer = useRef<number>(0);
  const longPressed = useRef(false);
  const lastPointer = useRef("");

  // Warm the vibe the next click will go to, once the page has finished loading.
  useEffect(() => {
    const run = () => whenIdle(() => warm(nextVibe(getVibe(), cycle)));
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
    return () => window.removeEventListener("load", run);
  }, [cycle]);

  useEffect(
    () => () => {
      window.clearTimeout(pressTimer.current);
      window.clearTimeout(tipTimer.current);
      window.clearTimeout(flickTimer.current);
    },
    [],
  );

  const switchVibe = useCallback(async () => {
    const startedAt = performance.now();
    performance.mark("vibe-switch-start");
    const from = target.current ?? getVibe();
    const to = nextVibe(from, cycle);
    target.current = to;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      setFlick(true);
      window.clearTimeout(flickTimer.current);
      flickTimer.current = window.setTimeout(() => setFlick(false), 280);
    }

    await fontReady(to);

    let release: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const canTransition = !reduced && typeof document.startViewTransition === "function";

    if (canTransition) {
      const transition = document.startViewTransition(() => {
        setVibe(to, { source: "hand", startedAt, settled, usedViewTransition: true });
      });
      transition.finished.then(release, release);
    } else {
      setVibe(to, { source: "hand", startedAt, settled, usedViewTransition: false });
      release();
    }

    settled.then(() => {
      if (target.current === to) target.current = null;
      performance.mark("vibe-switch-end");
      whenIdle(() => warm(nextVibe(to, cycle)));
    });
  }, [cycle]);

  const clearPress = () => window.clearTimeout(pressTimer.current);

  // The visitor is about to click: make sure the vibe this click goes to is warm (a no-op once it is).
  const warmNext = () => warm(nextVibe(target.current ?? getVibe(), cycle));

  const hideTipSoon = () => {
    window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => setTipOpen(false), TIP_HOLD_MS);
  };

  return (
    <button
      type="button"
      data-vibe-hand=""
      data-flick={flick ? "1" : undefined}
      data-tip={tipOpen ? "open" : undefined}
      aria-label={`Change vibe, current: ${VIBE_NAMES[vibe]}, next: ${VIBE_NAMES[next]}`}
      className={`group relative inline-flex min-h-11 min-w-11 touch-manipulation items-center gap-2 rounded-button border-token bg-surface px-3 py-1.5 text-sm font-semibold text-ink shadow-button select-none [-webkit-touch-callout:none] ${className}`}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        void switchVibe();
      }}
      onPointerEnter={warmNext}
      onFocus={warmNext}
      onPointerDown={(event) => {
        warmNext();
        lastPointer.current = event.pointerType;
        if (event.pointerType !== "touch") return;
        longPressed.current = false;
        clearPress();
        pressTimer.current = window.setTimeout(() => {
          longPressed.current = true;
          setTipOpen(true);
        }, LONG_PRESS_MS);
      }}
      onPointerUp={() => {
        clearPress();
        if (longPressed.current) hideTipSoon();
      }}
      onPointerCancel={() => {
        clearPress();
        if (longPressed.current) hideTipSoon();
      }}
      onContextMenu={(event) => {
        if (lastPointer.current === "touch") event.preventDefault();
      }}
    >
      {VIBES.map((v) => (
        <span key={`hand-${v}`} data-v={v} aria-hidden="true">
          <span className="vibe-hand" data-hand={v} />
        </span>
      ))}
      {VIBES.map((v) => (
        <span key={`name-${v}`} data-v={v}>
          {VIBE_NAMES[v]}
        </span>
      ))}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-full left-0 z-50 mt-2 rounded-md bg-ink px-2.5 py-1 text-xs font-medium whitespace-nowrap text-bg opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[tip=open]:opacity-100"
      >
        {VIBES.map((v) => (
          <span key={`tip-${v}`} data-v={v}>
            Next: {VIBE_NAMES[nextVibe(v, cycle)]}
          </span>
        ))}
      </span>
    </button>
  );
}
