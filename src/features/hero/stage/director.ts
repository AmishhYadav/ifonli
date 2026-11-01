/**
 * The Director owns the live stage: it measures the poster, builds the timeline for the active vibe's
 * motion profile, and handles everything around playback (pause reasons, off-screen and hidden-tab pause,
 * hover/focus pause with the product label, the Pause/Play toggle, analytics events) and the vibe switch
 * (a short wall-clock dissolve, then the new profile restarts from the top of its loop). No React in here;
 * `HeroStage` mounts it.
 */
import gsap from "gsap";

import { VIBES, VIBE_NAMES, type Vibe } from "@/features/vibe/config";
import { getVibe, subscribe } from "@/features/vibe/store";

import type { HeroEventName, HeroEventProps } from "./analytics";
import { computeGeometry, type Cell, type Geometry, type Rect } from "./geometry";
import { profileFor } from "./profiles";
import type { MotionProfile } from "./profiles/types";
import { collectRefs, type StageRefs } from "./refs";
import {
  HERO_TIME_SCALE,
  MIN_SWITCH_SPACING,
  PROFILE_FADE,
  REST_TIME,
  sceneAt,
  wrapTime,
} from "./schedule";
import { assignTiles, type StageLayout, type StageTile } from "./tiles";
import { buildTimeline } from "./timeline";

export type PauseReason = "user" | "hover" | "focus" | "offscreen" | "hidden" | "test";

export interface DirectorState {
  /** Loop time in seconds (0..12). */
  t: number;
  scene: number;
  /** Vibe whose motion profile is playing. */
  profile: Vibe;
  /** Vibe the stage is switching to (dissolve queued or running), if any. */
  pending: Vibe | null;
  /** Phase of the switch dissolve: waiting for the spacing rule, fading out, or fading back in. */
  switching: "wait" | "out" | "in" | null;
  paused: PauseReason[];
  tileCount: number;
  ready: boolean;
}

export interface HeroTestHook {
  ready: boolean;
  /** Put the playhead at loop time `t` (seconds). Does not change pause state. */
  seek(t: number): void;
  /** Pause / resume under the "test" reason, independent of the visitor's Pause button. */
  pause(): void;
  play(): void;
  state(): DirectorState;
}

declare global {
  interface Window {
    __ifonliHero?: HeroTestHook;
  }
}

export interface DirectorOptions {
  host: HTMLElement;
  tiles: Record<Vibe, StageTile[]>;
  vibe: Vibe;
  layout: StageLayout;
  /** Measure the text card and the poster cells from the document (the real hero). Frames pass false and a size. */
  measure: boolean;
  size?: { w: number; h: number };
  /** Real stage: listeners, label, toggle, observers. Storyboard frames render one frame and stop. */
  interactive: boolean;
  emit?: (name: HeroEventName, props: HeroEventProps) => void;
  navigate?: (href: string) => void;
  /** Warm the product page when a tile is hovered or focused (the poster's links prefetch on their own). */
  prefetch?: (href: string) => void;
  exposeForTests?: boolean;
}

const rel = (r: DOMRect, origin: DOMRect): Rect => ({
  x: r.left - origin.left,
  y: r.top - origin.top,
  w: r.width,
  h: r.height,
});

export class Director {
  private readonly o: DirectorOptions;
  private refs!: StageRefs;
  private tl: gsap.core.Timeline | null = null;
  private profile: MotionProfile;
  private readonly reasons = new Set<PauseReason>();
  /** Latest vibe asked for and not yet on stage. Coalesces rapid switches: only the last one is built. */
  private target: Vibe | null = null;
  private fade: gsap.core.Tween | null = null;
  private fadeKind: "out" | "in" | null = null;
  private delay: gsap.core.Tween | null = null;
  /** Wall-clock ms at which the last dissolve-out started (for MIN_SWITCH_SPACING). */
  private lastOutStart = -Infinity;
  private hoverTile: HTMLElement | null = null;
  private ready = false;
  private destroyed = false;
  private cleanups: (() => void)[] = [];
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private labelFor: HTMLElement | null = null;

  constructor(options: DirectorOptions) {
    this.o = options;
    this.profile = profileFor(options.vibe);
  }

  // ---------------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------------

  /** Interactive stage: build, show the rest frame, then follow the pause reasons. */
  mount(): void {
    this.refs = collectRefs(this.o.host);
    // The visitor may have changed vibe between render and mount: start on the current one.
    if (getVibe() !== this.profile.vibe) this.profile = profileFor(getVibe());
    this.applyTiles(this.profile.vibe);
    // Paused until the observers say the hero is on screen and the tab is visible.
    this.reasons.add("offscreen");
    if (document.hidden) this.reasons.add("hidden");
    this.listen();
    this.tryStart();
  }

  /** Build and show the rest frame once the host has a size. Returns false (and is retried on resize) if not. */
  private tryStart(): boolean {
    if (this.ready || this.destroyed) return this.ready;
    const { host } = this.o;
    // The vibe can change while the host has no size yet (the switch has nothing to dissolve then): adopt it now.
    if (this.target) {
      const v = this.target;
      this.target = null;
      if (v !== this.profile.vibe) {
        this.profile = profileFor(v);
        this.applyTiles(v);
      }
    }
    if (!this.layoutAndBuild()) return false;
    this.seekTo(REST_TIME);
    const section = host.closest<HTMLElement>("[data-hero]");
    this.ready = true;
    host.dataset.ready = "true";
    if (section) section.dataset.stage = "on";
    // The stage tiles are now the links: take the poster's tiles out of the tab order and the accessibility
    // tree (hero.css also makes them transparent, but they stay laid out, so nothing shifts).
    const posterLists = section
      ? [...section.querySelectorAll<HTMLElement>("[data-poster-list]")]
      : [];
    posterLists.forEach((list) => list.setAttribute("inert", ""));
    this.cleanups.push(() => {
      host.dataset.ready = "false";
      host.dataset.running = "false";
      if (section) delete section.dataset.stage;
      posterLists.forEach((list) => list.removeAttribute("inert"));
    });
    this.sync();
    this.expose();
    return true;
  }

  /** Storyboard frame: build for a size, render loop time `t`, and stop (styles stay, the timeline goes). */
  renderFrame(t: number): void {
    this.refs = collectRefs(this.o.host);
    this.applyTiles(this.profile.vibe);
    if (!this.layoutAndBuild()) return;
    this.tl?.totalTime(t, false);
    this.tl?.kill();
    this.tl = null;
    this.o.host.dataset.ready = "true";
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelSwitchTweens();
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.tl?.kill();
    this.tl = null;
    for (const fn of this.cleanups.splice(0)) fn();
    if (this.o.exposeForTests && typeof window !== "undefined") delete window.__ifonliHero;
  }

  // ---------------------------------------------------------------------------------------------------
  // Geometry and build
  // ---------------------------------------------------------------------------------------------------

  private measureGeometry(): Geometry | null {
    const { host, layout, measure, size } = this.o;
    let w = size?.w ?? 0;
    let h = size?.h ?? 0;
    let card: Rect | null = null;
    let cells: (Cell | null)[] | undefined;
    if (measure) {
      const box = host.getBoundingClientRect();
      w = box.width;
      h = box.height;
      const cardEl = document.querySelector<HTMLElement>("[data-hero-card]");
      if (cardEl) card = rel(cardEl.getBoundingClientRect(), box);
      const found: (Cell | null)[] = [];
      document.querySelectorAll<HTMLElement>("[data-hero] [data-poster-i]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const i = Number(el.dataset.posterI);
        if (r.width > 0 && r.height > 0 && Number.isInteger(i)) {
          found[i] = {
            x: r.left - box.left + r.width / 2,
            y: r.top - box.top + r.height / 2,
            size: r.width,
          };
        }
      });
      if (found.some(Boolean)) cells = found;
    }
    if (w < 8 || h < 8) return null;
    return computeGeometry({ w, h, layout, card, cells });
  }

  private layoutAndBuild(): boolean {
    const geo = this.measureGeometry();
    if (!geo) return false;
    const { host } = this.o;
    host.style.setProperty("--u", `${geo.unit}px`);
    host.dataset.dark = this.profile.veilDark;

    // Badges sit on the focal tiles; the second only exists on the wide layout.
    gsap.set(this.refs.badges[0] ?? [], {
      left: geo.solo.x,
      top: geo.solo.y,
      xPercent: -50,
      yPercent: -50,
    });
    gsap.set(this.refs.badges[1] ?? [], {
      left: geo.pairB.x,
      top: geo.pairB.y,
      xPercent: -50,
      yPercent: -50,
      display: geo.layout === "wide" ? "grid" : "none",
    });

    this.tl?.kill();
    const tl = buildTimeline({ refs: this.refs, profile: this.profile, geo });
    // Live speed. Applied to every (re)build, so a resize or a vibe switch never snaps back to full speed.
    // Loop time (totalTime, seek, the dissolve boundaries) is unaffected by the scale.
    tl.timeScale(HERO_TIME_SCALE);
    tl.eventCallback("onUpdate", this.tick);
    this.tl = tl;
    return true;
  }

  /** Rebuild at the same playhead (resize, profile switch). */
  private rebuild(): void {
    const tl = this.tl;
    if (!tl || this.destroyed) return;
    const t = tl.totalTime();
    if (!this.layoutAndBuild()) return;
    this.tl?.totalTime(t, false);
    this.sync();
  }

  // ---------------------------------------------------------------------------------------------------
  // Tiles
  // ---------------------------------------------------------------------------------------------------

  private applyTiles(vibe: Vibe): void {
    // A vibe with no products in the catalogue plays with the first vibe that has some, rather than freezing.
    const list = this.o.tiles[vibe]?.length
      ? this.o.tiles[vibe]
      : VIBES.map((v) => this.o.tiles[v]).find((l) => l?.length);
    if (!list || list.length === 0) return; // no products anywhere: keep what is there
    const assignments = assignTiles(list, this.refs.tiles.length);
    assignments.forEach(({ index, tile, duplicate }) => {
      const t = this.refs.tiles[index];
      if (!t) return;
      t.root.setAttribute("href", `/products/${tile.slug}`);
      t.root.setAttribute("aria-label", tile.name);
      t.root.dataset.heroTile = tile.slug;
      if (duplicate) {
        t.root.setAttribute("aria-hidden", "true");
        t.root.tabIndex = -1;
      } else {
        t.root.removeAttribute("aria-hidden");
        if (this.o.interactive) t.root.removeAttribute("tabindex");
      }
      if (t.img.getAttribute("src") !== tile.src) t.img.setAttribute("src", tile.src);
    });
    // Silhouettes for the burst use the first products' cutouts as masks.
    const unique = assignments.filter((a) => !a.duplicate).map((a) => a.tile.src);
    this.refs.sils.forEach((sil, k) => {
      const src = unique[k % unique.length];
      if (src) sil.style.setProperty("--sil-src", `url("${src}")`);
    });
    this.refs.badges.forEach((b) => {
      b.textContent = VIBE_NAMES[vibe];
    });
  }

  // ---------------------------------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------------------------------

  /**
   * Put the playhead at `t`. Events are NOT suppressed: the swirl in scene 6 renders through onUpdate, and a
   * suppressed seek would leave those tiles where the previous tween put them.
   */
  private seekTo(t: number): void {
    this.tl?.totalTime(t, false);
  }

  private readonly tick = (): void => {
    const tl = this.tl;
    if (!tl || this.destroyed) return;
    this.o.host.dataset.scene = String(sceneAt(tl.totalTime()).scene.id);
  };

  // ---------------------------------------------------------------------------------------------------
  // Vibe switch
  //
  // The site vibe changed: dissolve the stage out (PROFILE_FADE), build the new profile and tiles, restart its
  // loop from t = 0 and dissolve back in. The dissolve is a wall-clock GSAP tween on the content opacity, so it
  // runs whatever the loop is doing (hover, focus, test pause, off screen), and nothing waits for a scene
  // boundary. Rapid switches coalesce: a request during the fade-out only retargets, a request during the
  // fade-in or inside MIN_SWITCH_SPACING waits for the spacing rule, and the stage always ends on the last vibe.
  // ---------------------------------------------------------------------------------------------------

  private cancelSwitchTweens(): void {
    this.fade?.kill();
    this.fade = null;
    this.fadeKind = null;
    this.delay?.kill();
    this.delay = null;
  }

  /** Nobody is watching: visitor-paused, off screen, hidden tab. The swap needs no dissolve. */
  private unwatched(): boolean {
    return this.reasons.has("user") || this.reasons.has("offscreen") || this.reasons.has("hidden");
  }

  /** The site vibe changed. */
  requestVibe(next: Vibe): void {
    if (this.destroyed) return;
    this.target = next;
    if (!this.tl) return; // adopted by tryStart once the host has a size
    this.pump();
  }

  private pump(): void {
    const next = this.target;
    if (next === null || this.destroyed) return;
    if (this.unwatched()) {
      // Swap now, to the rest frame, and stay on it (paused or off screen); the Play button / return resumes.
      this.cancelSwitchTweens();
      this.swap();
      return;
    }
    if (this.fadeKind === "out") return; // the swap at the bottom of the fade reads the latest target
    if (next === this.profile.vibe && this.fadeKind === null && !this.delay) {
      this.target = null; // switched back to what is on stage: nothing to do
      return;
    }
    if (this.delay) return; // already queued; it reads the latest target
    const wait = Math.max(
      0,
      (this.lastOutStart + MIN_SWITCH_SPACING * 1000 - performance.now()) / 1000,
    );
    if (wait <= 0.001 && this.fadeKind === null) {
      this.startOut();
    } else {
      this.delay = gsap.delayedCall(Math.max(wait, 0.001), () => {
        this.delay = null;
        this.fade?.kill(); // a fade-in still running is finished by the new fade-out starting from its value
        this.fade = null;
        this.fadeKind = null;
        this.startOut();
      });
    }
  }

  private startOut(): void {
    this.lastOutStart = performance.now();
    this.fadeKind = "out";
    this.fade = gsap.to(this.refs.content, {
      opacity: 0,
      duration: PROFILE_FADE,
      ease: "sine.inOut",
      overwrite: true,
      onComplete: () => {
        this.fade = null;
        this.fadeKind = null;
        this.swap();
      },
    });
  }

  /** Build the latest target at the start of its loop and bring the stage back (dissolve in unless unwatched). */
  private swap(): void {
    const next = this.target;
    this.target = null;
    if (this.destroyed) return;
    const silent = this.unwatched();
    if (next && next !== this.profile.vibe) this.applyVibe(next, silent ? REST_TIME : 0);
    if (silent) {
      this.refs.content.style.opacity = "";
      return;
    }
    this.fadeKind = "in";
    this.fade = gsap.fromTo(
      this.refs.content,
      { opacity: 0 },
      {
        opacity: 1,
        duration: PROFILE_FADE,
        ease: "sine.inOut",
        overwrite: true,
        clearProps: "opacity",
        onComplete: () => {
          this.fade = null;
          this.fadeKind = null;
          this.pump(); // something else was asked for during the fade-in
        },
      },
    );
  }

  /** Swap the profile and tiles and restart the loop at `at`. Hover is stale after a swap: the tiles changed. */
  private applyVibe(vibe: Vibe, at: number): void {
    if (this.destroyed) return;
    this.profile = profileFor(vibe);
    this.applyTiles(vibe);
    this.reasons.delete("hover");
    this.hoverTile = null;
    if (!this.layoutAndBuild()) return;
    this.seekTo(at);
    const focused = document.activeElement;
    const focusTile = this.reasons.has("focus") && focused ? this.tileOf(focused) : null;
    if (focusTile) this.showLabel(focusTile);
    else this.hideLabel();
    this.sync();
  }

  private setReason(reason: PauseReason, on: boolean): void {
    const had = this.reasons.has(reason);
    if (on === had) return;
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    this.sync();
    // Nobody is watching any more: do not leave a dissolve to a throttled tab or a paused page.
    if (on && this.target && this.unwatched()) this.pump();
  }

  private tileOf(target: EventTarget | null): HTMLAnchorElement | null {
    return target instanceof Element
      ? target.closest<HTMLAnchorElement>("[data-stage-tile]")
      : null;
  }

  private sync(): void {
    const tl = this.tl;
    if (!tl) return;
    const playing = this.reasons.size === 0;
    if (playing) tl.play();
    else tl.pause();
    const { host } = this.o;
    host.dataset.running = String(playing);
    host.dataset.userPaused = String(this.reasons.has("user"));
    const toggle = host.querySelector<HTMLButtonElement>("[data-stage-toggle]");
    if (toggle) {
      const paused = this.reasons.has("user");
      toggle.setAttribute("aria-label", paused ? "Play hero animation" : "Pause hero animation");
      const text = toggle.querySelector("[data-toggle-text]");
      if (text) text.textContent = paused ? "Play" : "Pause";
    }
  }

  state(): DirectorState {
    const tt = this.tl?.totalTime() ?? 0;
    return {
      t: wrapTime(tt),
      scene: sceneAt(tt).scene.id,
      profile: this.profile.vibe,
      pending: this.target,
      switching: this.delay ? "wait" : this.fadeKind,
      paused: [...this.reasons],
      tileCount: this.refs?.tiles.length ?? 0,
      ready: this.ready,
    };
  }

  // ---------------------------------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------------------------------

  private emit(name: HeroEventName, props: HeroEventProps): void {
    this.o.emit?.(name, props);
  }

  private showLabel(tile: HTMLElement): void {
    const label = this.o.host.querySelector<HTMLElement>("[data-stage-label]");
    if (!label) return;
    const name = tile.getAttribute("aria-label") ?? "";
    label.textContent = name;
    const box = this.o.host.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    const lw = label.offsetWidth;
    const lh = label.offsetHeight;
    const x = Math.min(
      Math.max(r.left - box.left + r.width / 2 - lw / 2, 4),
      Math.max(4, box.width - lw - 4),
    );
    let y = r.top - box.top - lh - 8;
    if (y < 4) y = r.bottom - box.top + 8;
    label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    label.dataset.open = "true";
    this.labelFor = tile;
  }

  private prefetch(tile: HTMLElement): void {
    const href = tile.getAttribute("href");
    if (href) this.o.prefetch?.(href);
  }

  private hideLabel(): void {
    const label = this.o.host.querySelector<HTMLElement>("[data-stage-label]");
    if (label) label.dataset.open = "false";
    this.labelFor = null;
  }

  private listen(): void {
    const { host } = this.o;
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
    ) => {
      el.addEventListener(type, fn);
      this.cleanups.push(() => el.removeEventListener(type, fn));
    };
    const tileOf = (target: EventTarget | null) => this.tileOf(target);

    // Hover pauses only on real pointer movement onto a tile, never on a tile that merely arrived under a resting
    // pointer (browsers synthesise over/out events when content moves or a vibe switch swaps the tiles). The pause
    // ends as soon as the pointer leaves that tile, or the page scrolls, or the tab loses the pointer.
    let lastX = NaN;
    let lastY = NaN;
    const endHover = () => {
      if (!this.reasons.has("hover") && !this.hoverTile) return;
      this.hoverTile = null;
      this.setReason("hover", false);
      if (!this.reasons.has("focus")) this.hideLabel();
    };
    on(host, "pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const moved =
        Math.abs(e.clientX - lastX) >= 1 || Math.abs(e.clientY - lastY) >= 1 || Number.isNaN(lastX);
      lastX = e.clientX;
      lastY = e.clientY;
      if (!moved) return;
      const tile = tileOf(e.target);
      if (!tile) {
        endHover();
        return;
      }
      if (tile === this.hoverTile) return;
      this.hoverTile = tile;
      this.prefetch(tile);
      this.setReason("hover", true);
      this.showLabel(tile);
    });
    on(host, "pointerout", (e) => {
      const from = tileOf(e.target);
      if (!from || tileOf(e.relatedTarget) === from) return;
      if (from === this.hoverTile) endHover();
    });
    on(host, "pointerleave", () => endHover());
    const onScroll = () => endHover();
    window.addEventListener("scroll", onScroll, { passive: true });
    this.cleanups.push(() => window.removeEventListener("scroll", onScroll));
    const onBlur = () => endHover();
    window.addEventListener("blur", onBlur);
    this.cleanups.push(() => window.removeEventListener("blur", onBlur));

    on(host, "focusin", (e) => {
      const tile = tileOf(e.target);
      if (!tile) return;
      this.prefetch(tile);
      this.setReason("focus", true);
      this.showLabel(tile);
    });
    on(host, "focusout", (e) => {
      if (!tileOf(e.target)) return;
      this.setReason("focus", false);
      if (!this.reasons.has("hover")) this.hideLabel();
    });
    on(host, "keydown", (e) => {
      // WCAG 1.4.13: the label is dismissable without moving the pointer or focus.
      if (e.key === "Escape" && this.labelFor) this.hideLabel();
    });
    on(host, "click", (e) => {
      const tile = tileOf(e.target);
      if (tile) {
        this.emit("hero_tile_click", {
          slug: tile.dataset.heroTile ?? "",
          position: Number(tile.dataset.i ?? -1),
          vibe: this.profile.vibe,
          animated: true,
        });
        const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
        const href = tile.getAttribute("href");
        if (this.o.navigate && href && !modified && !e.defaultPrevented) {
          e.preventDefault();
          this.o.navigate(href);
        }
        return;
      }
      const toggle = e.target instanceof Element ? e.target.closest("[data-stage-toggle]") : null;
      if (toggle) {
        const nowPaused = !this.reasons.has("user");
        this.setReason("user", nowPaused);
        this.emit(nowPaused ? "hero_pause" : "hero_play", {
          vibe: this.profile.vibe,
          scene: sceneAt(this.tl?.totalTime() ?? 0).scene.id,
        });
        // A visitor who resumes while the pointer rests on a tile should not be re-paused by stale hover.
      }
    });

    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1];
        if (last) this.setReason("offscreen", !last.isIntersecting);
      });
      io.observe(host);
      this.cleanups.push(() => io.disconnect());
    } else {
      this.setReason("offscreen", false);
    }

    const onVisibility = () => this.setReason("hidden", document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));

    const unsubscribe = subscribe(() => this.requestVibe(getVibe()));
    this.cleanups.push(unsubscribe);

    if (typeof ResizeObserver !== "undefined") {
      let first = true;
      const ro = new ResizeObserver(() => {
        if (!this.ready) {
          this.tryStart();
          return;
        }
        if (first) {
          first = false;
          return;
        }
        if (this.resizeTimer) clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => this.rebuild(), 150);
      });
      ro.observe(host);
      this.cleanups.push(() => ro.disconnect());
    }
  }

  private expose(): void {
    if (!this.o.exposeForTests) return;
    window.__ifonliHero = {
      ready: true,
      seek: (t) => this.seekTo(t),
      pause: () => this.setReason("test", true),
      play: () => this.setReason("test", false),
      state: () => this.state(),
    };
  }
}
