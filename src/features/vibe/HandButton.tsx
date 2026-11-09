"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import "@/styles/motion.css";

import { DEFAULT_VIBE_CYCLE, VIBES, VIBE_NAMES, nextVibe, type Vibe } from "./config";
import { getVibe, subscribe } from "./store";
import {
  currentOrPendingVibe,
  prefersReducedMotion,
  switchTheme,
  warmOtherVibeFonts,
  warmVibeFont,
  whenIdle,
} from "./switch";
import { useVibe } from "./useVibe";

const LONG_PRESS_MS = 500;
const TIP_HOLD_MS = 1600;

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

interface Props {
  /** Cycle order (later phases pass settings.vibe_cycle). */
  cycle?: readonly Vibe[];
  className?: string;
}

/**
 * The vibe switcher: a hand with swinging charms, top-left. One hand variant per vibe is in the markup
 * (`<span data-v>` wrappers); CSS shows the active one (flags in tokens/*.css), so the right hand is on
 * the first paint, before hydration. The "card turn" replays whenever the vibe changes after hydration, from
 * any source (this hand, a nav pill, a vibe page), by alternating `data-turn` on the button (see
 * styles/motion.css); nothing sets it on load, so there is no flip at page load, and never under reduced
 * motion. A click switches the site (shared `switchVibeTo`) and, on a `/vibes/<slug>` page, also opens the
 * next vibe's collection so the page follows the theme. A "Turn Me" label always sits under the hand (no hover needed). Plan section 8.4.
 */
export function HandButton({ cycle = DEFAULT_VIBE_CYCLE, className = "" }: Props) {
  const { vibe } = useVibe();
  const next = nextVibe(vibe, cycle);
  const [tipOpen, setTipOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const pressTimer = useRef<number>(0);
  const tipTimer = useRef<number>(0);
  const longPressed = useRef(false);
  const lastPointer = useRef("");

  // Once the page has finished loading and is idle, warm the display fonts of the other vibes (the next click's
  // first), so no switch waits on a font download. Nothing starts before the load event.
  useEffect(() => {
    const run = () => whenIdle(() => warmOtherVibeFonts(getVibe(), cycle));
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

  // Flip the hand whenever the vibe changes after hydration, whoever changed it.
  useEffect(() => {
    let last = getVibe();
    return subscribe(() => {
      const now = getVibe();
      if (now === last) return;
      last = now;
      const button = buttonRef.current;
      if (button && !prefersReducedMotion()) button.dataset.turn = button.dataset.turn === "a" ? "b" : "a";
    });
  }, []);

  const switchVibe = useCallback(() => {
    const to = nextVibe(currentOrPendingVibe(), cycle);
    // Stays on the page, except on a theme's own page, which follows the theme (shared rule: switchTheme).
    void switchTheme(to, "hand", router, {
      onSettled: () => whenIdle(() => warmOtherVibeFonts(to, cycle)),
    });
  }, [cycle, router]);

  const clearPress = () => window.clearTimeout(pressTimer.current);

  // The visitor is about to click: make sure the vibe this click goes to is warm (a no-op once it is).
  const warmNext = () => void warmVibeFont(nextVibe(currentOrPendingVibe(), cycle));

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
        switchVibe();
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
        Turn Me <span className="hand-pill-arrow">&#x21BB;</span>
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
