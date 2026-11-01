/**
 * "Fly to bag / wishlist": a small ghost of the product flies from where the shopper acted to the header icon,
 * which then pulses. Client-only helpers (everything no-ops during SSR).
 *
 * Quick add from a product card:
 *
 *   flyToTarget(cardImageElement, "cart", { src: cardImageElement.currentSrc });
 *
 * Call it synchronously in the click handler (optimistic: do not wait for the add request). Wishlist works the
 * same with `"wishlist"`; when the wishlist icon is not on screen (mobile) nothing flies.
 */

export type FlyTargetName = "cart" | "wishlist";

export interface FlyVisual {
  /** Image URL of the thing that flies (a product photo). */
  src?: string;
  /** Emoji fallback when there is no image. */
  emoji?: string;
}

const FLY_MS = 850;
const FLY_EASING = "cubic-bezier(.5,0,.3,1)";
const PULSE_MS = 300;
const GHOST_SIZE = 60;

/** The least a candidate has to expose to be judged visible (DOM `Element` satisfies it). */
export interface Measurable {
  getClientRects(): ArrayLike<unknown>;
}

/** First candidate that currently has a layout box (display:none ancestors, e.g. `hidden md:inline-flex`, have none). */
export function pickVisible<T extends Measurable>(candidates: Iterable<T>): T | null {
  for (const candidate of candidates) {
    if (candidate.getClientRects().length > 0) return candidate;
  }
  return null;
}

const reducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The first visible header element tagged `data-fly-target="cart" | "wishlist"`, or null. */
export function findFlyTarget(target: FlyTargetName): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return pickVisible(document.querySelectorAll<HTMLElement>(`[data-fly-target="${target}"]`));
}

/** Scale the target 1 > 1.35 > 1 (a gentler 1.1 under reduced motion). */
export function pulseTarget(target: FlyTargetName | Element | null): void {
  if (typeof window === "undefined" || !target) return;
  const el = typeof target === "string" ? findFlyTarget(target) : target;
  if (!el || typeof el.animate !== "function") return;
  const peak = reducedMotion() ? 1.1 : 1.35;
  el.animate([{ transform: "scale(1)" }, { transform: `scale(${peak})` }, { transform: "scale(1)" }], {
    duration: PULSE_MS,
    easing: "ease-out",
  });
}

/**
 * Flies a 60x60 ghost (the product image, or an emoji) from `source`'s centre to the header cart / wishlist
 * icon, then pulses the icon. Resolves when the animation has ended; never rejects. Reduced motion: no flight,
 * only a gentle pulse.
 */
export function flyToTarget(source: Element | null, target: FlyTargetName, visual: FlyVisual = {}): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined" || !source) return Promise.resolve();
  const targetEl = findFlyTarget(target);
  if (!targetEl) return Promise.resolve();

  if (reducedMotion()) {
    pulseTarget(targetEl);
    return Promise.resolve();
  }

  const from = source.getBoundingClientRect();
  const to = targetEl.getBoundingClientRect();
  if (from.width === 0 && from.height === 0) {
    pulseTarget(targetEl);
    return Promise.resolve();
  }

  const startX = from.left + from.width / 2;
  const startY = from.top + from.height / 2;
  const dx = to.left + to.width / 2 - startX;
  const dy = to.top + to.height / 2 - startY;

  const ghost = document.createElement("div");
  ghost.className = "fly-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.left = `${startX - GHOST_SIZE / 2}px`;
  ghost.style.top = `${startY - GHOST_SIZE / 2}px`;
  if (visual.src) {
    const img = document.createElement("img");
    img.src = visual.src;
    img.alt = "";
    img.decoding = "async";
    ghost.appendChild(img);
  } else {
    ghost.textContent = visual.emoji ?? "\u{1F6CD}️";
    ghost.dataset.emoji = "";
  }
  document.body.appendChild(ghost);

  return new Promise((resolve) => {
    const done = () => {
      ghost.remove();
      pulseTarget(targetEl);
      resolve();
    };
    if (typeof ghost.animate !== "function") {
      done();
      return;
    }
    const animation = ghost.animate(
      [
        { transform: "translate(0,0) scale(1.4)", opacity: 1 },
        {
          transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 80}px) scale(0.8) rotate(180deg)`,
          opacity: 1,
          offset: 0.6,
        },
        { transform: `translate(${dx}px, ${dy}px) scale(0.1) rotate(360deg)`, opacity: 0.3 },
      ],
      { duration: FLY_MS, easing: FLY_EASING, fill: "forwards" },
    );
    animation.onfinish = done;
    animation.oncancel = done;
  });
}
