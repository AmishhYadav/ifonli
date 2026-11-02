import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

import { VIBES } from "@/features/vibe/config";

import type { BgState } from "./data";

/**
 * Landing scroll choreography. Client only, loaded with a dynamic import so none of it (gsap, ScrollTrigger,
 * lenis) reaches other routes or the first paint.
 *
 * Rules this file follows:
 *  - Smooth scroll is Lenis on the page only, driven by GSAP's ticker. Touch keeps its native momentum.
 *  - Everything is scrubbed to scroll position and built inside gsap.matchMedia(), so it reverts on unmount
 *    and rebuilds when the breakpoint flips.
 *  - Only transform, opacity and (on the portal card alone) clip-path are animated. Counting figures swap
 *    text and the texture offset is one CSS variable.
 *  - The hand-off to /home fires once, after a real user gesture, when scrolling DOWN reaches the end.
 */

let registered = false;
function register() {
  if (registered) return;
  gsap.registerPlugin(ScrollTrigger);
  registered = true;
}

export interface MotionOptions {
  root: HTMLElement;
  /** `document.fonts.load()` descriptors for the five display fonts. */
  fontDescriptors: readonly string[];
  /** Navigate to the store. */
  onEnter: () => void;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function startLandingMotion({ root, fontDescriptors, onEnter }: MotionOptions): () => void {
  register();
  ScrollTrigger.config({ ignoreMobileResize: true });

  const all = <T extends HTMLElement = HTMLElement>(selector: string, scope: ParentNode = root): T[] =>
    Array.from(scope.querySelectorAll<T>(selector));
  const one = <T extends HTMLElement = HTMLElement>(selector: string, scope: ParentNode = root): T | null =>
    scope.querySelector<T>(selector);

  /* ------------------------------------------------------------ smooth scroll */
  const lenis = new Lenis({ lerp: 0.1, smoothWheel: true, autoRaf: false });
  lenis.scrollTo(0, { immediate: true, force: true });
  const tick = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  lenis.on("scroll", ScrollTrigger.update);

  /* ------------------------------------------------------------ hand-off guards */
  delete root.dataset.state;
  const status = one("[data-portal-status]");
  if (status) status.textContent = "";
  let gestured = false;
  let entering = false;
  let resetTimer: number | undefined;
  const markGesture = () => {
    gestured = true;
  };
  const gestureEvents = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  for (const name of gestureEvents) window.addEventListener(name, markGesture, { passive: true });

  const enter = () => {
    if (entering) return;
    entering = true;
    root.dataset.state = "entering";
    if (status) status.textContent = "Opening the store...";
    lenis.stop();
    onEnter();
    // If the navigation never happens (offline), give the visitor their scroll back.
    resetTimer = window.setTimeout(() => {
      entering = false;
      delete root.dataset.state;
      if (status) status.textContent = "";
      lenis.start();
    }, 8000);
  };

  /* ------------------------------------------------------------ background */
  const bg = one("[data-bg]");
  /** Colour layers slide up over each other like curtains (transform only); blobs cross-fade by opacity. */
  const curtains = new Map<string, HTMLElement[]>();
  const blobs = new Map<string, HTMLElement[]>();
  if (bg) {
    for (const el of all("[data-state]", bg)) {
      const state = el.dataset.state as BgState;
      if (state === "site" && !el.classList.contains("l-blob__fill")) continue;
      const group = el.classList.contains("l-blob__fill") ? blobs : curtains;
      group.set(state, [...(group.get(state) ?? []), el]);
    }
  }
  const slid: Record<string, string> = {};
  const glow: Record<string, number> = {};
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  /** The curtain element starts 8rem above the screen so its rounded top edge is off-screen once it has landed. */
  const OVERSCAN = 128;
  /**
   * `e` 0..1 is how far the curtain has risen (its leading edge goes from the bottom of the screen to the top);
   * `lift` (px) then carries a landed curtain up and away (the last mood leaving with its stage).
   */
  const slide = (state: string, e: number, hidden: boolean, lift = 0) => {
    const ty = Math.round((1 - e) * (window.innerHeight + OVERSCAN) - lift);
    const key = hidden || e <= 0 ? "hidden" : String(ty);
    if (slid[state] === key) return;
    slid[state] = key;
    for (const el of curtains.get(state) ?? []) {
      el.style.visibility = key === "hidden" ? "hidden" : "visible";
      el.style.transform = `translate3d(0, ${ty}px, 0)`;
    }
  };
  const fade = (state: string, value: number) => {
    const v = round3(value);
    if (glow[state] === v) return;
    glow[state] = v;
    for (const el of blobs.get(state) ?? []) el.style.opacity = String(v);
  };
  const ramp = (x: number, from: number, to: number) => clamp01((x - from) / (to - from));
  const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

  /** Scroll-driven inputs, each scrubbed by its own trigger; applyBg turns them into layer positions. */
  const S = { enter: 0, t: 0, exit: 0, portal: 0, page: 0 };
  /** Mood m changes over t in [m - STEP, m + STEP]: text leaves, the curtain rises, then the new text arrives. */
  const STEP = 0.2;
  const last = VIBES.length - 1;
  const applyBg = () => {
    // Entering the moods, leaving them, and the portal follow the page's own edges 1:1 (the curtain's edge IS the
    // stage's edge, so text above it never sits on the incoming colour). Mood to mood is eased and pinned.
    const rise: number[] = VIBES.map((_, m) => (m === 0 ? S.enter : ease(ramp(S.t, m - STEP + 0.04, m - STEP + 0.28))));
    const lift = S.exit * window.innerHeight;
    VIBES.forEach((vibe, m) => {
      const above = m === last ? S.portal : rise[m + 1]!;
      const gone = m === last && S.exit >= 1;
      slide(vibe, rise[m]!, gone || above >= 1, m === last ? lift : 0);
    });
    slide("accent", S.portal, false);

    VIBES.forEach((vibe, m) => {
      const inR = m === 0 ? ramp(S.enter, 0.6, 1) : ramp(S.t, m - STEP + 0.22, m - STEP + 0.4);
      const outR = m === last ? ramp(S.exit, 0, 0.3) : ramp(S.t, m + 1 - STEP, m + 1 - STEP + 0.14);
      fade(vibe, inR * (1 - outR));
    });
    const leftSite = ramp(S.enter, 0, 0.4) * (1 - ramp(S.exit, 0.3, 0.7));
    fade("site", (1 - leftSite) * (1 - ramp(S.portal, 0, 0.4)));
    fade("accent", ramp(S.portal, 0.6, 1));
  };
  const resetBg = () => {
    S.enter = S.t = S.exit = S.portal = S.page = 0;
    for (const key of Object.keys(slid)) delete slid[key];
    for (const key of Object.keys(glow)) delete glow[key];
    for (const state of curtains.keys()) slide(state, 0, false);
    for (const state of blobs.keys()) fade(state, state === "site" ? 1 : 0);
    bg?.style.setProperty("--l-tex", "0");
  };

  /* ------------------------------------------------------------ fonts + refresh */
  let fontsRequested = false;
  const loadMoodFonts = () => {
    if (fontsRequested) return;
    fontsRequested = true;
    void Promise.all(fontDescriptors.map((d) => document.fonts.load(d)))
      .catch(() => undefined)
      .then(() => {
        root.dataset.fontsReady = "";
        ScrollTrigger.refresh();
      });
  };
  void document.fonts.ready.then(() => ScrollTrigger.refresh());
  const onLoad = () => ScrollTrigger.refresh();
  if (document.readyState !== "complete") window.addEventListener("load", onLoad, { once: true });
  let refreshTimer: number | undefined;
  const content = one(".l-content");
  const resizeObserver = content
    ? new ResizeObserver(() => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 200);
      })
    : null;
  if (content) resizeObserver?.observe(content);

  /* ------------------------------------------------------------ choreography */
  const mm = gsap.matchMedia();
  mm.add({ desktop: "(min-width: 768px)", mobile: "(max-width: 767px)" }, (context) => {
    const desktop = Boolean(context.conditions?.desktop);
    resetBg();
    const restore: Array<() => void> = [];

    /* page-long: texture offset + blob parallax (different rates and scrub lags) */
    const pageTrigger = { trigger: root, start: "top top", end: "bottom bottom" } as const;
    gsap.to(S, {
      page: 1,
      ease: "none",
      onUpdate: () => bg?.style.setProperty("--l-tex", S.page.toFixed(4)),
      scrollTrigger: { ...pageTrigger, scrub: 1.4 },
    });
    const blobConfig: Record<string, { y: number; x: number; scale: number; scrub: number }> = {
      a: { y: -0.45, x: 0.07, scale: 1.3, scrub: 0.9 },
      b: { y: -0.75, x: -0.09, scale: 0.82, scrub: 1.3 },
      c: { y: -1.15, x: 0.1, scale: 1.5, scrub: 1.8 },
    };
    for (const blob of all("[data-blob]")) {
      const cfg = blobConfig[blob.dataset.blob ?? "a"]!;
      gsap.to(blob, {
        y: () => cfg.y * window.innerHeight * (desktop ? 1 : 0.8),
        x: () => cfg.x * window.innerWidth,
        scale: cfg.scale,
        ease: "none",
        scrollTrigger: { ...pageTrigger, scrub: cfg.scrub, invalidateOnRefresh: true },
      });
    }

    /* 1. opening: wordmark lifts away, cutouts scatter at their own depth */
    const opening = one("[data-opening]");
    if (opening) {
      const lift = one("[data-open-lift]", opening);
      const cue = one("[data-cue]", opening);
      const span = () => `+=${Math.round(window.innerHeight * 0.9)}`;
      if (lift) {
        gsap.to(lift, {
          y: () => -window.innerHeight * 0.14,
          scale: 1.1,
          opacity: 0,
          ease: "none",
          scrollTrigger: { trigger: opening, start: "top top", end: span, scrub: 0.6, invalidateOnRefresh: true },
        });
      }
      if (cue) {
        gsap.to(cue, {
          opacity: 0,
          ease: "none",
          scrollTrigger: { trigger: opening, start: "top top", end: () => `+=${Math.round(window.innerHeight * 0.18)}`, scrub: true },
        });
      }
      for (const cut of all("[data-cut]", opening)) {
        if (!cut.offsetParent) continue; // hidden on this breakpoint
        const depth = Number(cut.dataset.depth ?? 1);
        gsap.to(cut, {
          x: () => (cut.offsetLeft + cut.offsetWidth / 2 - opening.offsetWidth / 2) * depth * 1.15,
          y: () =>
            (cut.offsetTop + cut.offsetHeight / 2 - opening.offsetHeight / 2) * depth * 0.9 -
            window.innerHeight * 0.3 * depth,
          rotation: (depth > 1 ? 1 : -1) * 38 * depth,
          scale: 0.8 + depth * 0.25,
          ease: "none",
          scrollTrigger: {
            trigger: opening,
            start: "top top",
            end: "bottom top",
            scrub: 0.4 + depth * 0.45,
            invalidateOnRefresh: true,
          },
        });
      }
      // Idle drift is CSS; stop paying for it once the opening has scrolled away.
      ScrollTrigger.create({
        trigger: opening,
        start: "top top",
        end: "bottom top",
        onToggle: (self) => root.toggleAttribute("data-hero-paused", !self.isActive),
      });
    }

    /* generic text reveal: rises in with the element's own scroll position, then simply scrolls away */
    for (const el of all("[data-reveal]")) {
      const y = el.matches("h2") ? 60 : 44;
      gsap.fromTo(
        el,
        { opacity: 0, y },
        { opacity: 1, y: 0, ease: "power1.out", scrollTrigger: { trigger: el, start: "top 97%", end: "top 64%", scrub: 0.6 } },
      );
    }

    /* 2. what we make: each kind rises and settles (rotation easing to 0), then stays in full view */
    for (const item of all("[data-make]")) {
      const art = one(".l-make__art", item);
      const texts = all("[data-make-text]", item);
      const tilt = Number.parseFloat(getComputedStyle(item).getPropertyValue("--r")) || 8;
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: item, start: "top 100%", end: "top 62%", scrub: 0.7 },
      });
      if (art) tl.fromTo(art, { y: 150, rotation: tilt * 1.9, scale: 0.8, opacity: 0 }, { y: 0, rotation: 0, scale: 1, opacity: 1, duration: 0.8, ease: "power2.out" }, 0);
      tl.fromTo(texts, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.1, ease: "power1.out" }, 0.25);
    }

    /* 3. four moods: pinned (CSS sticky), background and panels cross-fade together */
    const track = one("[data-moods-track]");
    if (track) {
      const panels = all(".l-mood", track);
      const parts = panels.map((panel) => ({
        panel,
        inner: one("[data-mood-in]", panel)!,
        name: one("[data-mood-name]", panel)!,
        tag: one("[data-mood-tag]", panel)!,
        count: one("[data-mood-count]", panel)!,
        cuts: all("[data-mood-cut]", panel),
      }));

      ScrollTrigger.create({ trigger: track, start: "top bottom+=120%", once: true, onEnter: loadMoodFonts });

      // Before the pin: the stage scrolls in, the cute curtain rises, then the first mood arrives.
      const first = parts[0];
      if (first) {
        gsap.fromTo(
          first.inner,
          { opacity: 0, y: 80 },
          { opacity: 1, y: 0, ease: "none", scrollTrigger: { trigger: track, start: "top 62%", end: "top 6%", scrub: 0.5 } },
        );
        gsap.to(S, {
          enter: 1,
          ease: "none",
          onUpdate: applyBg,
          scrollTrigger: { trigger: track, start: "top 100%", end: "top 0%", scrub: true },
        });
      }

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: track, start: "top top", end: "bottom bottom", scrub: 0.5 },
      });
      tl.to(S, { t: VIBES.length, duration: VIBES.length, onUpdate: applyBg }, 0);
      for (let i = 1; i < parts.length; i += 1) {
        const prev = parts[i - 1]!;
        const cur = parts[i]!;
        const T = i - STEP;
        // Out, then in: the outgoing text is gone (T + 0.14) before the incoming starts (T + 0.16), and the
        // curtain (T + 0.04 .. T + 0.28) is already over the old colour by then. No double exposure.
        tl.to(prev.panel, { opacity: 0, duration: 0.14 }, T);
        tl.to(prev.name, { yPercent: -24, duration: 0.16, ease: "power1.in" }, T);
        tl.to(prev.tag, { y: -30, duration: 0.16, ease: "power1.in" }, T);
        tl.to(prev.cuts, { y: -110, rotation: "+=14", duration: 0.16, stagger: 0.015, ease: "power1.in" }, T);
        tl.fromTo(cur.panel, { opacity: 0 }, { opacity: 1, duration: 0.1 }, T + 0.18);
        tl.fromTo(cur.name, { yPercent: 30 }, { yPercent: 0, duration: 0.2, ease: "power2.out" }, T + 0.16);
        tl.fromTo(cur.tag, { y: 38, opacity: 0 }, { y: 0, opacity: 1, duration: 0.16, ease: "power1.out" }, T + 0.2);
        tl.fromTo(cur.count, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.14, ease: "power1.out" }, T + 0.19);
        tl.fromTo(cur.cuts, { y: 130, scale: 0.7, rotation: "-=18" }, { y: 0, scale: 1, rotation: "+=18", duration: 0.2, stagger: 0.035, ease: "power2.out" }, T + 0.19);
      }

      // After the pin releases the last mood's colour leaves with its stage, edge for edge.
      gsap.to(S, {
        exit: 1,
        ease: "none",
        onUpdate: applyBg,
        scrollTrigger: { trigger: track, start: "bottom bottom", end: "bottom top", scrub: true },
      });
    }

    /* 4. why IfOnli: figures count up with the scroll */
    for (const fig of all("[data-count]")) {
      const target = Number(fig.dataset.count);
      if (!Number.isFinite(target)) continue;
      const prefix = fig.dataset.prefix ?? "";
      const suffix = fig.dataset.suffix ?? "";
      const format = new Intl.NumberFormat("en-IN");
      const counter = { v: 0 };
      let shown = -1;
      const paint = () => {
        const n = Math.round(counter.v);
        if (n === shown) return;
        shown = n;
        fig.textContent = `${prefix}${format.format(n)}${suffix}`;
      };
      gsap.fromTo(
        counter,
        { v: 0 },
        {
          v: target,
          ease: "power1.out",
          onUpdate: paint,
          scrollTrigger: { trigger: fig, start: "top 90%", end: "top 48%", scrub: 0.6 },
        },
      );
      const original = fig.textContent;
      restore.push(() => {
        fig.textContent = original;
      });
      paint();
    }

    /* 5. portal: a card in the middle opens to fill the screen, then the store takes over */
    const portalTrack = one("[data-portal-track]");
    const card = one("[data-portal-card]");
    if (portalTrack && card) {
      const inner = one("[data-portal-in]", card);
      const cuts = all("[data-portal-cut]", card);
      const insets = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        return desktop
          ? { x: Math.round(w * 0.28), y: Math.round(h * 0.16), r: 40 }
          : { x: Math.round(w * 0.07), y: Math.round(h * 0.17), r: 28 };
      };

      gsap.to(S, {
        portal: 1,
        ease: "none",
        onUpdate: applyBg,
        scrollTrigger: { trigger: portalTrack, start: "top 100%", end: "top 0%", scrub: true },
      });

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: portalTrack,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.6,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            if (self.progress >= 0.985 && self.direction === 1 && gestured) enter();
          },
        },
      });
      tl.fromTo(
        card,
        { clipPath: () => { const o = insets(); return `inset(${o.y}px ${o.x}px ${o.y}px ${o.x}px round ${o.r}px)`; } },
        { clipPath: "inset(0px 0px 0px 0px round 0px)", duration: 0.78, ease: "power2.inOut" },
        0,
      );
      if (inner) tl.fromTo(inner, { scale: 0.86 }, { scale: 1, duration: 0.78, ease: "power2.inOut" }, 0);
      if (cuts.length > 0) {
        tl.fromTo(cuts, { scale: 0.55, rotation: "-=22" }, { scale: 1, rotation: "+=22", duration: 0.7, stagger: 0.025, ease: "power2.out" }, 0.04);
      }
    }

    applyBg();
    return () => {
      // Reverting the context removes every inline transform; text and layer opacities are ours to restore.
      for (const fn of restore) fn();
      resetBg();
    };
  });

  return () => {
    window.clearTimeout(resetTimer);
    window.clearTimeout(refreshTimer);
    for (const name of gestureEvents) window.removeEventListener(name, markGesture);
    window.removeEventListener("load", onLoad);
    resizeObserver?.disconnect();
    mm.revert();
    for (const trigger of ScrollTrigger.getAll()) trigger.kill();
    gsap.ticker.remove(tick);
    gsap.ticker.lagSmoothing(500, 33);
    lenis.destroy();
    for (const els of curtains.values()) {
      for (const el of els) {
        el.style.removeProperty("transform");
        el.style.removeProperty("visibility");
      }
    }
    for (const els of blobs.values()) for (const el of els) el.style.removeProperty("opacity");
    bg?.style.removeProperty("--l-tex");
    delete root.dataset.state;
    delete root.dataset.fontsReady;
    root.removeAttribute("data-hero-paused");
  };
}
