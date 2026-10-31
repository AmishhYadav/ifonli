import type { HeroEventDetail, HeroEventName } from "@/features/hero/stage/analytics";
import type { EventMeta, TrackProps } from "@/lib/analytics/events";

/**
 * Maps a hero DOM event (`ifonli:analytics`, see docs/HERO.md) onto a first-party `track()` call.
 * `vibe` becomes the event's vibe; `position` becomes `meta.tile` (Insights groups tile clicks by it);
 * every other prop is kept as meta.
 */
export function heroEventToTrack(detail: HeroEventDetail): { name: HeroEventName; props: TrackProps } {
  const { vibe, ...rest } = detail.props;
  const meta: EventMeta = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key === "position") meta.tile = String(value);
    else meta[key] = value;
  }
  return {
    name: detail.name,
    props: { vibe: typeof vibe === "string" ? vibe : undefined, meta },
  };
}
