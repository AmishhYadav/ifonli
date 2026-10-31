import { getImageProps } from "next/image";

import { VIBES, type Vibe } from "@/features/vibe/config";
import { imageProps } from "@/server/services/media";
import type { HeroTile } from "@/server/services/catalog";

import type { StageTile } from "./stage/tiles";

/**
 * Tile data for the animated stage: per vibe, each product once (name, slug, an optimised image URL sized for
 * the stage). Computed on the server so the lazy chunk needs no image component and no further requests.
 */
export function stageTilesFor(sets: Record<string, HeroTile[]>): Record<Vibe, StageTile[]> {
  const out = {} as Record<Vibe, StageTile[]>;
  for (const vibe of VIBES) {
    out[vibe] = [];
    for (const tile of sets[vibe] ?? []) {
      try {
        const { props } = getImageProps({
          src: imageProps(tile.cutout).src,
          alt: "",
          // next/image picks the 2x candidate (384 px) as `src`, enough for a 200 px tile on a dense screen.
          width: 192,
          height: 192,
        });
        out[vibe].push({ slug: tile.slug, name: tile.name, src: props.src });
      } catch (error) {
        console.error(`HeroPoster: unusable cutout for "${tile.slug}"`, error);
      }
    }
  }
  return out;
}
