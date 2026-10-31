import { buttonVariants } from "@/components/ui/buttonStyles";
import { VIBE_NAMES, type Vibe } from "@/features/vibe/config";

import { backingOf } from "./look";
import { POOL } from "./refs";
import type { TileAssignment } from "./tiles";

import "@/styles/hero.css";

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Plain class join: the lazy chunk stays free of tailwind-merge (the classes here never conflict). */
const join = (...parts: (string | false | undefined)[]): string => parts.filter(Boolean).join(" ");

/** Sprite icon (same markup as the shared Icon component, without pulling its class merger into the chunk). */
function SpriteIcon({ name, className }: { name: "pause" | "play"; className: string }) {
  return (
    <svg className={join("icon", className)} aria-hidden="true" focusable="false">
      <use href={`/icons/sprite.svg#i-${name}`} />
    </svg>
  );
}

interface Props {
  assignments: readonly TileAssignment[];
  vibe: Vibe;
  /** Real stage: Pause/Play control, product label, links with tab stops. Storyboard frames pass false. */
  interactive: boolean;
  className?: string;
}

/**
 * The stage markup: one backdrop canvas, two colour veils, an SVG layer for connectors, the product tiles
 * (real links), vibe badges, silhouettes and shadow streaks. Rendered once; the Director drives it with GSAP
 * and, on a vibe switch, swaps the tile content imperatively (React never re-renders it).
 */
export function HeroStageView({ assignments, vibe, interactive, className }: Props) {
  return (
    <div
      data-hero-stage-inner=""
      data-ready="false"
      data-running="false"
      className={join("hero-stage", className)}
    >
      {interactive && (
        <button
          type="button"
          data-stage-toggle=""
          aria-label="Pause hero animation"
          className={join(buttonVariants({ variant: "secondary", size: "sm" }), "stage-toggle")}
        >
          <SpriteIcon name="pause" className="stage-toggle-pause size-5" />
          <SpriteIcon name="play" className="stage-toggle-play size-5" />
          <span data-toggle-text="">Pause</span>
        </button>
      )}

      <div data-stage-content="" className="stage-content">
        <div data-stage-canvas="" className="stage-canvas" />
        <div data-stage-veil="dark" className="stage-veil stage-veil-dark" />
        <div data-stage-glow="" className="stage-glow" />

        <svg data-stage-svg="" className="stage-svg" aria-hidden="true" focusable="false">
          <path data-svg="selection" className="stage-line" />
          {range(POOL.spokes).map((i) => (
            <path key={`s${i}`} data-svg="spoke" className="stage-line stage-spoke" />
          ))}
          {range(POOL.links).map((i) => (
            <path key={`l${i}`} data-svg="link" className="stage-line stage-link" />
          ))}
          {range(POOL.handles).map((i) => (
            <circle key={`h${i}`} data-svg="handle" className="stage-handle" />
          ))}
          {range(POOL.anchors).map((i) => (
            <circle key={`a${i}`} data-svg="anchor" className="stage-anchor" />
          ))}
        </svg>

        <div
          data-stage-tiles=""
          role="group"
          aria-label="Featured products"
          className="stage-tiles"
        >
          {assignments.map(({ index, tile, duplicate }) => {
            const bg = backingOf(index);
            return (
              <a
                key={index}
                data-stage-tile=""
                data-i={index}
                data-hero-tile={tile.slug}
                href={`/products/${tile.slug}`}
                aria-label={tile.name}
                aria-hidden={duplicate || undefined}
                tabIndex={interactive && !duplicate ? undefined : -1}
                className="stage-tile"
              >
                <span data-layer="sq" className={join("stage-bk border-token shadow-card", bg)} />
                <span
                  data-layer="rd"
                  className={join("stage-bk rounded-card border-token shadow-card", bg)}
                />
                <span
                  data-layer="ci"
                  className={join("stage-bk rounded-full border-token shadow-card", bg)}
                />
                <span data-layer="hi" className="stage-bk stage-ring" />
                {/* Already-optimised URL from the server (next/image getImageProps): a plain img keeps the
                    lazy chunk free of the image component and lets the Director swap sources per vibe. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tile.src}
                  alt=""
                  draggable={false}
                  decoding="async"
                  className="stage-img"
                />
              </a>
            );
          })}
        </div>

        {range(POOL.badges).map((i) => (
          <div
            key={`b${i}`}
            data-stage-badge=""
            aria-hidden="true"
            className="stage-badge font-display"
          >
            {VIBE_NAMES[vibe]}
          </div>
        ))}
        <div data-stage-veil="solid" className="stage-veil stage-veil-solid" />
        {range(POOL.sils).map((i) => (
          <div
            key={`z${i}`}
            data-stage-sil=""
            aria-hidden="true"
            className="stage-sil"
            data-sil={i % 4}
          />
        ))}
        {range(POOL.streaks).map((i) => (
          <div key={`t${i}`} data-stage-streak="" aria-hidden="true" className="stage-streak" />
        ))}
      </div>

      {interactive && <span data-stage-label="" aria-hidden="true" className="stage-label" />}
    </div>
  );
}
