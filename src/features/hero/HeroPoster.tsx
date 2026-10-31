import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { VibeCopy } from "@/components/store/VibeCopy";
import { Button } from "@/components/ui";
import type { Vibe } from "@/features/vibe/config";
import { cn } from "@/lib/cn";
import { getHeroTilesForAllVibes } from "@/server/cache/catalog";
import { getVibeSettings } from "@/server/cache/settings";
import { imageProps } from "@/server/services/media";
import type { HeroTile } from "@/server/services/catalog";

import { HeroEnhancer } from "./HeroEnhancer";
import { backingOf, shapeOf } from "./stage/look";
import { stageTilesFor } from "./stageTiles";

/**
 * Each vibe renders TWO tile lists (left and right of the headline card on lg, stacked above it below lg), each
 * with up to 6 tiles: 3 per list on phones (3x2 in total), 6 per list from md (6x2), 4 per list from lg (2x2 on
 * both sides of the card). Only the first tiles are fetched at high priority; hidden vibes stay lazy and never load.
 */
const TILES_PER_LIST = 6;
const HIGH_PRIORITY_PER_LIST = 2;

const TILTS = ["-2deg", "1.5deg", "0deg", "2deg", "-1deg", "0deg", "1deg"] as const;

interface PosterTile {
  tile: HeroTile;
  /** Position in the whole poster (drives backing colour and shape). */
  index: number;
  /** Repeated to fill the grid: hidden from assistive tech and the tab order. */
  duplicate: boolean;
}

/** Fewer curated tiles than grid cells: repeat them (plan section 9) rather than leave holes. */
function fillTiles(tiles: HeroTile[], count: number): PosterTile[] {
  if (tiles.length === 0) return [];
  return Array.from({ length: count }, (_, index) => ({
    tile: tiles[index % tiles.length]!,
    index,
    duplicate: index >= tiles.length,
  }));
}

/** Per-position visibility: item 4 and 5 of a list only show from md; item 6 hides again on lg (2x2 per side). */
function tileVisibility(position: number): string {
  if (position >= 4) return "max-md:hidden lg:hidden";
  if (position >= 3) return "max-md:hidden";
  return "";
}

function TileList({
  cells,
  vibe,
  side,
}: {
  cells: PosterTile[];
  vibe: Vibe;
  side: "left" | "right";
}) {
  return (
    <ul
      className={cn(
        "grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-6 lg:grid-cols-2",
        side === "left"
          ? "order-1 lg:col-start-1 lg:row-start-1"
          : "order-2 lg:col-start-3 lg:row-start-1",
      )}
      data-testid={`hero-tiles-${vibe}-${side}`}
      data-poster-list=""
    >
      {cells.map(({ tile, index, duplicate }, position) => {
        let src: string | null = null;
        try {
          src = imageProps(tile.cutout).src;
        } catch (error) {
          console.error(`HeroPoster: unusable cutout for "${tile.slug}"`, error);
        }
        if (!src) return null;
        return (
          <li
            key={`${tile.productId}-${index}`}
            className={cn(
              "hero-tile relative aspect-square border-token shadow-card ease-vibe",
              backingOf(index),
              shapeOf(index),
              tileVisibility(position),
            )}
            style={{ "--tile-tilt": TILTS[index % TILTS.length] } as React.CSSProperties}
            data-poster-i={index}
          >
            <Link
              href={`/products/${tile.slug}`}
              data-hero-tile={tile.slug}
              aria-label={tile.name}
              aria-hidden={duplicate || undefined}
              tabIndex={duplicate ? -1 : undefined}
              className="absolute inset-0 rounded-[inherit]"
            >
              <Image
                src={src}
                alt=""
                fill
                // Lazy everywhere: a hidden vibe's tiles must not download. The visible first tiles are
                // still fetched immediately (in viewport) at high priority.
                loading="lazy"
                fetchPriority={position < HIGH_PRIORITY_PER_LIST ? "high" : "low"}
                sizes="(min-width: 1024px) 14vw, (min-width: 768px) 16vw, 30vw"
                className="object-contain p-[14%]"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TileSet({ vibe, tiles }: { vibe: Vibe; tiles: HeroTile[] }) {
  const cells = fillTiles(tiles, TILES_PER_LIST * 2);
  if (cells.length === 0) return null;
  // Interleave so both sides get distinct products when there are few curated tiles.
  const left = cells.filter((_, i) => i % 2 === 0);
  const right = cells.filter((_, i) => i % 2 === 1);
  return (
    // data-v wrapper is display: contents, shown only when this is the active vibe (zero-network switch).
    // Its lists therefore take part directly in the hero grid.
    <div data-v={vibe}>
      <TileList cells={left} vibe={vibe} side="left" />
      <TileList cells={right} vibe={vibe} side="right" />
    </div>
  );
}

/**
 * Static poster hero (plan section 9): product cutouts on vibe-coloured square/circle backings in a grid,
 * with the headline, sub-line and Shop button in a separate top layer that is never animated away.
 * All five vibes' tile sets are in the markup; CSS shows the active one. This is the server-rendered LCP
 * view, and the only view for reduced motion, save-data, slow connections and no JS.
 *
 * `HeroEnhancer` (a small client component) mounts into `#hero-stage-root` and, only when the hero is in the
 * viewport, after idle, and the visitor allows motion, lazily loads the animated `HeroStage`, which lays
 * itself over the poster cells without moving anything (no layout shift). Pass `stage` to override (tests).
 */
export async function HeroPoster({ stage }: { stage?: ReactNode }) {
  const [sets, { cycle, defaultVibe }] = await Promise.all([
    getHeroTilesForAllVibes(TILES_PER_LIST * 2),
    getVibeSettings(),
  ]);
  const first = defaultVibe === "random" ? cycle[0] : defaultVibe;
  const order = [first, ...cycle.filter((v) => v !== first)].filter((v): v is Vibe => Boolean(v));

  return (
    <section
      aria-label="Welcome to IfOnli"
      data-hero=""
      className="relative mx-auto max-w-[1440px] px-4 pt-5 pb-14 sm:px-6 lg:pt-8"
    >
      <div className="relative grid gap-3 sm:gap-4 lg:grid-cols-[1fr_minmax(26rem,34rem)_1fr] lg:items-center lg:gap-6">
        {order.map((vibe) => (
          <TileSet key={vibe} vibe={vibe} tiles={sets[vibe] ?? []} />
        ))}

        {/* Mount point for the animated HeroStage. It renders its own accessible links and Pause/Play control. */}
        <div
          id="hero-stage-root"
          data-hero-stage=""
          className="pointer-events-none absolute inset-0"
        >
          {stage ?? <HeroEnhancer tiles={stageTilesFor(sets)} />}
        </div>

        {/* Text layer: always above the tiles, never animated away. */}
        <div
          data-hero-card=""
          className="relative z-10 order-3 mt-1 rounded-card border-token bg-surface p-6 text-ink shadow-card sm:p-8 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:p-10"
        >
          <VibeCopy
            k="hero.headline"
            as="h1"
            className="font-display text-4xl leading-[1.05] display-fx sm:text-5xl"
          />
          <VibeCopy k="hero.sub" as="p" className="mt-4 text-lg text-ink-muted" />
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg" iconEnd="arrow-right" data-testid="hero-shop">
              <Link href="/shop">
                <VibeCopy k="hero.cta" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="#vibes">Pick a vibe</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
