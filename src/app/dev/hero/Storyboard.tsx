"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Director } from "@/features/hero/stage/director";
import { defaultCard, type Rect } from "@/features/hero/stage/geometry";
import { HeroStageView } from "@/features/hero/stage/HeroStageView";
import { PROFILES } from "@/features/hero/stage/profiles";
import { SCENES, STORYBOARD_TIMES } from "@/features/hero/stage/schedule";
import {
  assignTiles,
  tileCountFor,
  type StageLayout,
  type StageTile,
} from "@/features/hero/stage/tiles";
import { VIBES, VIBE_NAMES, type Vibe } from "@/features/vibe/config";
import { VibeScope } from "@/features/vibe/VibeScope";

/** Logical size of a frame; the frame is scaled down to fit. */
const SIZES: Record<StageLayout, { w: number; h: number; scale: number }> = {
  wide: { w: 1280, h: 420, scale: 0.43 },
  stacked: { w: 390, h: 640, scale: 0.5 },
};

function MockCard({ rect }: { rect: Rect }) {
  return (
    <div
      className="absolute z-10 flex flex-col justify-center gap-3 rounded-card border-token bg-surface p-6 text-ink shadow-card"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <p className="font-display text-3xl leading-tight">Headline</p>
      <p className="text-ink-muted">Sub-line stands in for the real card.</p>
      <span className="inline-flex w-fit rounded-button border-token bg-accent px-6 py-3 font-semibold text-on-accent shadow-button">
        Shop now
      </span>
    </div>
  );
}

function Frame({
  vibe,
  tiles,
  layout,
  sceneIndex,
}: {
  vibe: Vibe;
  tiles: Record<Vibe, StageTile[]>;
  layout: StageLayout;
  sceneIndex: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { w, h, scale } = SIZES[layout];
  const t = STORYBOARD_TIMES[sceneIndex]!;
  const scene = SCENES[sceneIndex]!;
  const assignments = useMemo(
    () => assignTiles(tiles[vibe] ?? [], tileCountFor(layout)),
    [tiles, vibe, layout],
  );

  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    const host = hostRef.current?.querySelector<HTMLElement>("[data-hero-stage-inner]");
    if (!host) return;
    const director = new Director({
      host,
      tiles,
      vibe,
      layout,
      measure: false,
      size: { w, h },
      interactive: false,
    });
    director.renderFrame(t);
    return () => director.destroy();
  }, [near, tiles, vibe, layout, w, h, t]);

  return (
    <figure className="flex flex-col gap-1" data-testid={`frame-${vibe}-${scene.id}`}>
      <div
        className="relative overflow-hidden rounded-card border-token"
        style={{ width: w * scale, height: h * scale }}
      >
        <div
          ref={hostRef}
          className="absolute top-0 left-0"
          style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "0 0" }}
        >
          <HeroStageView assignments={assignments} vibe={vibe} interactive={false} />
          <MockCard rect={defaultCard(layout, w, h)} />
        </div>
      </div>
      <figcaption className="text-sm text-ink-muted">
        {scene.id}. {scene.name} <span className="tabular-nums">({t.toFixed(2)} s)</span>
      </figcaption>
    </figure>
  );
}

export function Storyboard({ tiles }: { tiles: Record<Vibe, StageTile[]> }) {
  const [layout, setLayout] = useState<StageLayout>("wide");
  const [only, setOnly] = useState<Vibe>(VIBES[0]!);
  return (
    <>
      <div role="group" aria-label="Vibe" className="flex flex-wrap gap-2">
        {VIBES.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={only === v}
            onClick={() => setOnly(v)}
            className="rounded-button border-token bg-surface px-4 py-2 text-ink aria-pressed:bg-accent aria-pressed:text-on-accent"
          >
            {VIBE_NAMES[v]}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Layout" className="flex gap-2">
        {(["wide", "stacked"] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={layout === l}
            onClick={() => setLayout(l)}
            className="rounded-button border-token bg-surface px-4 py-2 text-ink aria-pressed:bg-accent aria-pressed:text-on-accent"
          >
            {l === "wide" ? "Wide (desktop)" : "Stacked (phone)"}
          </button>
        ))}
      </div>
      {VIBES.filter((v) => v === only).map((vibe) => (
        <VibeScope
          key={vibe}
          vibe={vibe}
          as="section"
          aria-labelledby={`sb-${vibe}`}
          className="rounded-card p-4"
        >
          <h2 id={`sb-${vibe}`} className="font-display text-3xl">
            {VIBE_NAMES[vibe]}
          </h2>
          <p className="mb-3 text-ink-muted">{PROFILES[vibe].summary}</p>
          <div className="flex flex-wrap gap-4">
            {SCENES.map((scene, i) => (
              <Frame
                key={`${vibe}-${layout}-${scene.id}`}
                vibe={vibe}
                tiles={tiles}
                layout={layout}
                sceneIndex={i}
              />
            ))}
          </div>
        </VibeScope>
      ))}
    </>
  );
}
