/**
 * The one way to change the site's vibe from the UI: the hand, the nav pills, the mobile menu and a vibe
 * collection page all call `switchVibeTo`. The hand and the header theme pills go through `switchTheme`, which
 * holds the "stay on the page" rule. It warms the new display font (so the swap does not flash a
 * fallback face), runs the store write inside a view transition (cross-fade) unless the visitor prefers
 * reduced motion, and keeps the `ifonli:vibe-change` event / analytics `source` accurate.
 * Client-only: call it from event handlers and effects.
 */
import { DISPLAY_FONT_LOAD, type Vibe } from "./config";
import { getVibe, setVibe, type VibeSource } from "./store";

const FONT_WAIT_MS = 120;

const warmed = new Set<Vibe>();

/** Idle-time warm-up of a vibe's display font (so the NEXT switch needs no network). */
export function warmVibeFont(vibe: Vibe): void {
  if (warmed.has(vibe)) return;
  warmed.add(vibe);
  document.fonts?.load(DISPLAY_FONT_LOAD[vibe]).catch(() => {});
}

export function whenIdle(callback: () => void): void {
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

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The vibe a switch in flight is going to (so rapid clicks chain from it, not from the stale attribute). */
let pending: Vibe | null = null;

/** The vibe the site is (or is about to be) wearing. */
export function currentOrPendingVibe(): Vibe {
  return pending ?? getVibe();
}

export interface SwitchOptions {
  /**
   * Runs right after the vibe is applied (inside the view transition), so a navigation starts together
   * with the new theme instead of racing the font warm-up.
   */
  navigate?: () => void;
  /** Runs once the switch (and its view transition) has finished. */
  onSettled?: () => void;
}

/**
 * Switch the whole site to `to`. Resolves when the vibe is applied. A switch to the vibe already worn
 * still runs `navigate` (a pill for the current vibe just navigates).
 */
export async function switchVibeTo(to: Vibe, source: VibeSource, options: SwitchOptions = {}): Promise<void> {
  if (getVibe() === to && pending === null) {
    options.navigate?.();
    options.onSettled?.();
    return;
  }
  const startedAt = performance.now();
  performance.mark("vibe-switch-start");
  pending = to;

  const reduced = prefersReducedMotion();
  await fontReady(to);

  let release: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    release = resolve;
  });
  const apply = (usedViewTransition: boolean) => {
    setVibe(to, { source, startedAt, settled, usedViewTransition });
    options.navigate?.();
  };

  if (!reduced && typeof document.startViewTransition === "function") {
    const transition = document.startViewTransition(() => apply(true));
    transition.finished.then(release, release);
  } else {
    apply(false);
    release();
  }

  settled.then(() => {
    if (pending === to) pending = null;
    performance.mark("vibe-switch-end");
    options.onSettled?.();
  });
}

/** Matches the pathname of a theme's own page, `/vibes/<slug>`. */
const VIBE_PAGE = /^\/vibes\/[^/]+/;

/** Whether the visitor is on a theme's own collection page. */
export function isOnVibePage(pathname: string = window.location.pathname): boolean {
  return VIBE_PAGE.test(pathname);
}

/**
 * The page-follows-theme rule for the hand and the header theme pills, in one place. A visitor who switches theme
 * stays on the page they are on (so the `/home` hero keeps playing in the new theme), except on a theme's own page
 * `/vibes/<slug>`, which moves to `/vibes/<new>` so its products match the theme.
 */
export function switchTheme(
  to: Vibe,
  source: VibeSource,
  router: { push: (href: string) => void },
  options: Pick<SwitchOptions, "onSettled"> = {},
): Promise<void> {
  const follow = isOnVibePage();
  return switchVibeTo(to, source, {
    ...options,
    navigate: follow ? () => router.push(`/vibes/${to}`) : undefined,
  });
}
