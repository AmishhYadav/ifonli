/**
 * Hero analytics adapter. The hero does not depend on the first-party beacon: it dispatches a DOM
 * CustomEvent on `window`, and the app wires it to `track()` in one place:
 *
 *   window.addEventListener("ifonli:analytics", (e) => {
 *     const { name, props } = (e as CustomEvent<HeroEventDetail>).detail;
 *     track(name, props);
 *   });
 *
 * Events (all props are strings, numbers or booleans; no personal data):
 *   hero_impression  { vibe, animated }                         hero >= 50% visible for 1 s, once per page view
 *   hero_tile_click  { slug, position, vibe, animated }         a product tile was activated (poster or stage)
 *   hero_pause       { vibe, scene }                            the visitor pressed Pause
 *   hero_play        { vibe, scene }                            the visitor pressed Play
 */

export const HERO_ANALYTICS_EVENT = "ifonli:analytics";

export type HeroEventName = "hero_impression" | "hero_tile_click" | "hero_pause" | "hero_play";
export type HeroEventProps = Record<string, string | number | boolean>;

export interface HeroEventDetail {
  name: HeroEventName;
  props: HeroEventProps;
}

declare global {
  interface WindowEventMap {
    "ifonli:analytics": CustomEvent<HeroEventDetail>;
  }
}

export function emitHeroEvent(name: HeroEventName, props: HeroEventProps = {}): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent<HeroEventDetail>(HERO_ANALYTICS_EVENT, { detail: { name, props } }),
    );
  } catch {
    // analytics must never break the hero
  }
}
