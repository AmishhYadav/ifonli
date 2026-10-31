import type { Metadata } from "next";

import { stageTilesFor } from "@/features/hero/stageTiles";
import { getHeroTilesForAllVibes } from "@/server/cache/catalog";

import { assertDevPagesEnabled } from "../gate";

import { Storyboard } from "./Storyboard";

export const metadata: Metadata = {
  title: "Hero storyboard",
  robots: { index: false, follow: false },
};

/**
 * Dev-only hero storyboard (plan phase 2): ten still frames per vibe, one per scene, rendered by seeking the
 * real timeline to each scene's key timestamp. For owner review of the motion profiles without waiting 12 s.
 */
export default async function HeroStoryboardPage() {
  assertDevPagesEnabled();
  const tiles = stageTilesFor(await getHeroTilesForAllVibes(12));
  return (
    <main className="mx-auto flex max-w-[1680px] flex-col gap-10 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">Hero storyboard</h1>
        <p className="max-w-3xl text-ink-muted">
          Ten frames per vibe, one per scene of the 12 s loop, each rendered by seeking the
          production timeline. The text card is a mock-up standing in for the real card, which is
          never animated away.
        </p>
      </header>
      <Storyboard tiles={tiles} />
    </main>
  );
}
