/**
 * Listing impressions (D-19): a product card counts once per page view when at least half of it has been
 * visible for a full second while the tab is in the foreground. Cards are found by `data-product-id`
 * (set by `ProductCardView`), so any card that mounts later (client navigation, "load more") is picked up
 * by a MutationObserver without the card knowing about analytics.
 */

export const IMPRESSION_VISIBLE_RATIO = 0.5;
export const IMPRESSION_DWELL_MS = 1000;
export const PRODUCT_SELECTOR = "[data-product-id]";

export interface ImpressionObserver {
  /** Forget which products were counted (call on every client-side page view). */
  reset: () => void;
  stop: () => void;
}

export function startImpressionObserver(
  onImpression: (productId: string, position: number) => void,
): ImpressionObserver {
  if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") {
    return { reset: () => {}, stop: () => {} };
  }

  const counted = new Set<string>();
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  const watched = new WeakSet<Element>();

  const fire = (el: Element) => {
    timers.delete(el);
    const id = el instanceof HTMLElement ? el.dataset.productId : undefined;
    if (!id || counted.has(id) || document.visibilityState !== "visible") return;
    counted.add(id);
    const position = Array.from(document.querySelectorAll(PRODUCT_SELECTOR)).indexOf(el);
    onImpression(id, Math.max(0, position));
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const visible = entry.isIntersecting && entry.intersectionRatio >= IMPRESSION_VISIBLE_RATIO;
        const running = timers.get(entry.target);
        if (visible && !running) {
          timers.set(entry.target, setTimeout(() => fire(entry.target), IMPRESSION_DWELL_MS));
        } else if (!visible && running) {
          clearTimeout(running);
          timers.delete(entry.target);
        }
      }
    },
    { threshold: [0, IMPRESSION_VISIBLE_RATIO] },
  );

  const scan = () => {
    for (const el of document.querySelectorAll(PRODUCT_SELECTOR)) {
      if (!watched.has(el)) {
        watched.add(el);
        io.observe(el);
      }
    }
  };

  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  const mo = new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 150);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  scan();

  return {
    reset: () => {
      counted.clear();
      // Cards that stay on screen across the navigation get a fresh dwell timer.
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const el of document.querySelectorAll(PRODUCT_SELECTOR)) {
        io.unobserve(el);
        io.observe(el);
      }
    },
    stop: () => {
      io.disconnect();
      mo.disconnect();
      if (scanTimer) clearTimeout(scanTimer);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
