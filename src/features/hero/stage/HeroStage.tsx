"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { VIBES, type Vibe } from "@/features/vibe/config";
import { getVibe } from "@/features/vibe/store";

import { emitHeroEvent } from "./analytics";
import { Director } from "./director";
import { layoutFor } from "./geometry";
import { HeroStageView } from "./HeroStageView";
import { assignTiles, tileCountFor, type StageLayout, type StageTile } from "./tiles";
import { STAGE_CHUNK_MARKER } from "./timeline";

const exposeForTests =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

function currentLayout(): StageLayout {
  return layoutFor(window.innerWidth);
}

/** First vibe with tiles, preferring the active one: the markup needs something to render before the Director swaps. */
function seedTiles(tiles: Record<Vibe, StageTile[]>, vibe: Vibe): StageTile[] {
  return tiles[vibe]?.length
    ? tiles[vibe]
    : (VIBES.map((v) => tiles[v]).find((l) => l?.length) ?? []);
}

/**
 * The animated hero stage (default export of the lazily loaded chunk). It renders the markup once for the
 * current layout and hands it to the Director; the Director then owns it. React never re-renders it on a
 * vibe switch: the Director dissolves, swaps the profile and tiles, and restarts the loop itself.
 */
export default function HeroStage({ tiles }: { tiles: Record<Vibe, StageTile[]> }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<StageLayout>(currentLayout);
  const [initialVibe] = useState<Vibe>(getVibe);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setLayout(currentLayout());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const assignments = useMemo(
    () => assignTiles(seedTiles(tiles, initialVibe), tileCountFor(layout)),
    [tiles, initialVibe, layout],
  );

  useEffect(() => {
    const host = wrapRef.current?.querySelector<HTMLElement>("[data-hero-stage-inner]");
    if (!host) return;
    const director = new Director({
      host,
      tiles,
      vibe: getVibe(),
      layout,
      measure: true,
      interactive: true,
      emit: emitHeroEvent,
      navigate: (href) => router.push(href),
      prefetch: (href) => router.prefetch(href),
      exposeForTests,
    });
    director.mount();
    return () => director.destroy();
  }, [tiles, layout, router]);

  return (
    <div ref={wrapRef} className="contents" data-stage-chunk={STAGE_CHUNK_MARKER} key={layout}>
      <HeroStageView assignments={assignments} vibe={initialVibe} interactive />
    </div>
  );
}
