/**
 * The Director owns the live stage: it measures the poster, builds the timeline for the active vibe's
 * motion profile, and handles everything around playback (pause reasons, off-screen and hidden-tab pause,
 * hover/focus pause with the product label, the Pause/Play toggle, analytics events) and the profile switch
 * at the next scene boundary. No React in here; `HeroStage` mounts it.
 */
import gsap from "gsap";

import { VIBE_NAMES, type Vibe } from "@/features/vibe/config";
import { getVibe, subscribe } from "@/features/vibe/store";

import type { HeroEventName, HeroEventProps } from "./analytics";
import { computeGeometry, type Cell, type Geometry, type Rect } from "./geometry";
import { profileFor } from "./profiles";
import type { MotionProfile } from "./profiles/types";
import { collectRefs, type StageRefs } from "./refs";
import {
  MIN_SWITCH_SPACING,
  PROFILE_FADE,
  REST_TIME,
  dissolveOpacity,
  profileSwitchBoundary,
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
  /** Vibe waiting for the next scene boundary, if any. */
  pending: Vibe | null;
  pendingBoundary: number | null;
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
  private pending: { vibe: Vibe; boundary: number } | null = null;
  private lastSwitch = -Infinity;
  private fadeInAt: number | null = null;
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
    const list = this.o.tiles[vibe];
    if (!list || list.length === 0) return; // keep what is there
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
    const tt = tl.totalTime();
    this.o.host.dataset.scene = String(sceneAt(tt).scene.id);

    const pending = this.pending;
    if (pending && tt >= pending.boundary - 1e-6) {
      this.pending = null;
      this.lastSwitch = pending.boundary;
      this.fadeInAt = pending.boundary;
      // Rebuild after this render pass, while the content is at its most transparent.
      queueMicrotask(() => this.applyVibe(pending.vibe));
    }
    this.updateDissolve(tt);
  };

  private updateDissolve(tt: number): void {
    let o = 1;
    if (this.pending) o = Math.min(o, dissolveOpacity(tt, this.pending.boundary));
    if (this.fadeInAt !== null) {
      o = Math.min(o, dissolveOpacity(tt, this.fadeInAt));
      if (tt >= this.fadeInAt + PROFILE_FADE) this.fadeInAt = null;
    }
    this.refs.content.style.opacity = o >= 0.999 ? "" : String(o);
  }

  private applyVibe(vibe: Vibe): void {
    if (this.destroyed || vibe === this.profile.vibe) return;
    this.profile = profileFor(vibe);
    this.applyTiles(vibe);
    this.rebuild();
  }

  /** The site vibe changed: switch the motion profile at the next scene boundary. */
  requestVibe(next: Vibe): void {
    if (!this.tl) return;
    if (next === this.profile.vibe) {
      this.pending = null;
      this.updateDissolve(this.tl.totalTime());
      return;
    }
    // Nobody is watching (visitor-paused, off screen, hidden tab): swap now, no scene boundary to wait for.
    if (this.reasons.has("user") || this.reasons.has("offscreen") || this.reasons.has("hidden")) {
      this.pending = null;
      this.applyVibe(next);
      return;
    }
    const tt = this.tl.totalTime();
    this.pending = {
      vibe: next,
      boundary: profileSwitchBoundary(tt, PROFILE_FADE, this.lastSwitch + MIN_SWITCH_SPACING),
    };
  }

  private setReason(reason: PauseReason, on: boolean): void {
    const had = this.reasons.has(reason);
    if (on === had) return;
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    this.sync();
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
    if (this.reasons.has("hover") || this.reasons.has("focus"))
      this.refs.content.style.opacity = "";
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
      pending: this.pending?.vibe ?? null,
      pendingBoundary: this.pending ? this.pending.boundary : null,
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
    const tileOf = (target: EventTarget | null): HTMLAnchorElement | null =>
      target instanceof Element ? target.closest<HTMLAnchorElement>("[data-stage-tile]") : null;

    on(host, "pointerover", (e) => {
      const tile = tileOf(e.target);
      if (!tile || e.pointerType === "touch") return;
      this.prefetch(tile);
      this.setReason("hover", true);
      this.showLabel(tile);
    });
    on(host, "pointerout", (e) => {
      const from = tileOf(e.target);
      if (!from || tileOf(e.relatedTarget) === from) return;
      this.setReason("hover", false);
      if (!this.reasons.has("focus")) this.hideLabel();
    });
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
    // The vibe may have changed between render and mount.
    if (getVibe() !== this.profile.vibe) this.requestVibe(getVibe());

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
