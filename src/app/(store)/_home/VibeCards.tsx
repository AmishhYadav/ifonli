import Link from "next/link";

import { TileFan } from "@/components/store/TileFan";
import { VibeCopy } from "@/components/store/VibeCopy";
import { VIBE_TAGLINES } from "@/components/store/vibe-taglines";
import { Icon } from "@/components/ui";
import { isVibe, type Vibe } from "@/features/vibe/config";
import { VibeScope } from "@/features/vibe/VibeScope";
import { textOr } from "@/lib/seo";
import { getCollections, getHeroTilesForAllVibes } from "@/server/cache/catalog";

/** Five collection cards, each wrapped in its own VibeScope (its own palette, shape, type and texture). */
export async function VibeCards() {
  const [collections, tiles] = await Promise.all([getCollections(), getHeroTilesForAllVibes(3)]);
  const vibes = collections.vibes.filter((v) => isVibe(v.slug));

  return (
    <section
      id="vibes"
      aria-label="Shop by vibe"
      className="mx-auto mt-14 max-w-[1440px] scroll-mt-24 px-4 sm:px-6"
    >
      <VibeCopy k="home.vibesTitle" as="h2" className="font-display text-3xl display-fx sm:text-4xl" />
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {vibes.map((v) => {
          const vibe = v.slug as Vibe;
          const covers = (tiles[vibe] ?? []).slice(0, 3);
          return (
            <li key={v.slug} className="min-w-0">
              <VibeScope
                vibe={vibe}
                as="article"
                className="group relative flex h-full flex-col gap-3 overflow-hidden rounded-card border-token p-5 text-ink shadow-card transition-transform ease-vibe hover:-translate-y-1 has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus-ring"
              >
                <TileFan tiles={covers} />
                <h3 className="font-display text-3xl leading-tight display-fx">
                  <Link
                    href={`/vibes/${v.slug}`}
                    className="outline-none after:absolute after:inset-0 after:content-['']"
                  >
                    {v.name}
                  </Link>
                </h3>
                <p className="text-base text-ink-muted">{textOr(v.description, VIBE_TAGLINES[vibe])}</p>
                <p className="mt-auto flex items-center justify-between pt-2 text-sm font-semibold">
                  <span>{v.productCount} products</span>
                  <Icon
                    name="arrow-right"
                    className="size-6 transition-transform ease-vibe group-hover:translate-x-1"
                  />
                </p>
              </VibeScope>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
