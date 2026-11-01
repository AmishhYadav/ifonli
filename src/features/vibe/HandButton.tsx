"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import "@/styles/motion.css";

import {
  DEFAULT_VIBE_CYCLE,
  DISPLAY_FONT_LOAD,
  VIBES,
  VIBE_NAMES,
  nextVibe,
  type Vibe,
} from "./config";
import { getVibe, setVibe } from "./store";
import { useVibe } from "./useVibe";

const FONT_WAIT_MS = 120;
const LONG_PRESS_MS = 500;
const TIP_HOLD_MS = 1600;

const warmed = new Set<Vibe>();

/** Idle-time warm-up of a vibe's display font (so the NEXT switch needs no network). */
function warm(vibe: Vibe): void {
  if (warmed.has(vibe)) return;
  warmed.add(vibe);
  document.fonts?.load(DISPLAY_FONT_LOAD[vibe]).catch(() => {});
}

/** The charms that hang at the five fingertips. A vibe without an entry (a renamed or new one) uses the first set. */
const CHARMS: Partial<Record<string, readonly string[]>> = {
  cute: ["\u{1F361}", "\u{1F380}", "\u{1F430}", "\u{1F353}", "\u2601\uFE0F"],
  gothic: ["\u{1F987}", "\u{1F480}", "\u{1F577}\uFE0F", "\u{1F319}", "\u{1F56F}\uFE0F"],
  funky: ["\u{1F344}", "\u{1F47E}", "\u{1F300}", "\u{1F3B2}", "\u{1F996}"],
  bold: ["\u{1F48B}", "\u{1F525}", "\u26A1", "\u{1F451}", "\u{1F48E}"],
};
const FALLBACK_CHARMS = CHARMS.cute!;

/** Fingertip positions in the 90x90 hand viewBox. */
const TIPS: readonly (readonly [number, number])[] = [
  [14, 46],
  [30, 18],
  [46, 10],
  [62, 16],
  [76, 32],
];

/** One vibe's hand: a skin-coloured hand, or a dashed skeleton in the gothic theme, with swinging charms. */
function HandVariant({ vibe }: { vibe: Vibe }) {
  const skeleton = vibe === "gothic";
  const charms = CHARMS[vibe] ?? FALLBACK_CHARMS;
  return (
    <span className="hand-flip" data-hand={vibe}>
      <svg className="hand-svg" viewBox="0 0 90 90" focusable="false">
        {skeleton ? (
          <>
            {TIPS.map(([x, y], i) => (
              <line
                key={i}
                x1={32 + i * 7}
                y1={54}
                x2={x}
                y2={y}
                stroke="currentColor"
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray="8 3"
              />
            ))}
            <rect x={28} y={52} width={34} height={26} rx={6} fill="none" stroke="currentColor" strokeWidth={3} />
          </>
        ) : (
          <>
            {TIPS.map(([x, y], i) => (
              <line
                key={i}
                x1={32 + i * 7}
                y1={56}
                x2={x}
                y2={y}
                stroke="var(--hand-skin)"
                strokeWidth={9}
                strokeLinecap="round"
              />
            ))}
            <rect
              x={26}
              y={50}
              width={38}
              height={30}
              rx={12}
              fill="var(--hand-skin)"
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeWidth={1}
            />
          </>
        )}
      </svg>
      {TIPS.map(([x, y], i) => (
        <span
          key={i}
          className="hand-charm"
          style={{ left: `${(x / 90) * 100 - 9}%`, top: `${(y / 90) * 100 + 2}%`, "--i": i } as CSSProperties}
        >
          {charms[i]}
        </span>
      ))}
    </span>
  );
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
 * The vibe switcher: a hand with swinging charms, top-left. One hand variant per vibe is in the markup
 * (`<span data-v>` wrappers); CSS shows the active one (flags in tokens/*.css), so the right hand is on
 * the first paint, before hydration. A click re-plays the "card turn" by alternating `data-turn` on the
 * button (see styles/motion.css); nothing sets it on load, so there is no flip at page load. Plan section 8.4.
 */
export function HandButton({ cycle = DEFAULT_VIBE_CYCLE, className = "" }: Props) {
  const { vibe } = useVibe();
  const next = nextVibe(vibe, cycle);
  const [tipOpen, setTipOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const target = useRef<Vibe | null>(null);
  const pressTimer = useRef<number>(0);
  const tipTimer = useRef<number>(0);
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
    await fontReady(to);

    // Restart the card-turn on the hand that is about to appear: alternate two identically-keyed animations.
    const turn = () => {
      const button = buttonRef.current;
      if (button && !reduced) button.dataset.turn = button.dataset.turn === "a" ? "b" : "a";
    };

    let release: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const canTransition = !reduced && typeof document.startViewTransition === "function";

    if (canTransition) {
      const transition = document.startViewTransition(() => {
        turn();
        setVibe(to, { source: "hand", startedAt, settled, usedViewTransition: true });
      });
      transition.finished.then(release, release);
    } else {
      turn();
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
      ref={buttonRef}
      type="button"
      data-vibe-hand=""
      data-tip={tipOpen ? "open" : undefined}
      aria-label={`Change vibe, current: ${VIBE_NAMES[vibe]}, next: ${VIBE_NAMES[next]}`}
      className={`hand-btn ${className}`}
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
      <span className="hand-stage" aria-hidden="true">
        {VIBES.map((v) => (
          <span key={v} data-v={v}>
            <HandVariant vibe={v} />
          </span>
        ))}
      </span>
      <span aria-hidden="true" className="hand-pill">
        turn me &#x21BB;
      </span>
      <span aria-hidden="true" className="hand-tip">
        {VIBES.map((v) => (
          <span key={`tip-${v}`} data-v={v}>
            Next: {VIBE_NAMES[nextVibe(v, cycle)]}
          </span>
        ))}
      </span>
    </button>
  );
}
