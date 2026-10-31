import { describe, expect, it } from "vitest";

import { heroEventToTrack } from "@/features/analytics/hero-bridge";
import { CLIENT_EVENTS } from "@/lib/analytics/events";

describe("heroEventToTrack", () => {
  it("maps a tile click: vibe to the event, position to meta.tile", () => {
    expect(
      heroEventToTrack({
        name: "hero_tile_click",
        props: { slug: "skull-charm", position: 3, vibe: "gothic", animated: true },
      }),
    ).toEqual({
      name: "hero_tile_click",
      props: { vibe: "gothic", meta: { slug: "skull-charm", tile: "3", animated: true } },
    });
  });

  it("keeps the scene for pause and play", () => {
    expect(heroEventToTrack({ name: "hero_pause", props: { vibe: "cute", scene: 4 } })).toEqual({
      name: "hero_pause",
      props: { vibe: "cute", meta: { scene: 4 } },
    });
  });

  it("only sends events the ingest route accepts", () => {
    for (const name of ["hero_impression", "hero_tile_click", "hero_pause", "hero_play"] as const) {
      expect(CLIENT_EVENTS).toContain(heroEventToTrack({ name, props: {} }).name);
    }
  });
});
