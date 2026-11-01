import Link from "next/link";

import { TileFan } from "@/components/store/TileFan";
import { VibeCopy } from "@/components/store/VibeCopy";
import { VIBE_TAGLINES } from "@/components/store/vibe-taglines";
import { Icon } from "@/components/ui/Icon";
import { isVibe, type Vibe } from "@/features/vibe/config";
import { VibeScope } from "@/features/vibe/VibeScope";
import { cn } from "@/lib/cn";
import { textOr } from "@/lib/seo";
import { getCollections, getHeroTilesForAllVibes } from "@/server/cache/catalog";

/** Static class names (Tailwind must see them whole): each card's cover sits on its own vibe's art gradient. */
const ART: Record<Vibe, string> = {
  cute: "art-cute",
  funky: "art-funky",
  bold: "art-bold",
  gothic: "art-gothic",
};

/** Four collection cards, each wrapped in its own VibeScope (its own palette, shape, type and texture). */
export async function VibeCards() {
  const [collections, tiles] = await Promise.all([getCollections(), getHeroTilesForAllVibes(3)]);
  const vibes = collections.vibes.filter((v) => isVibe(v.slug));

  return (
    <section
      id="vibes"
      aria-label="Shop by vibe"
      className="below-fold mx-auto mt-14 max-w-[1440px] px-4 sm:px-6"
    >
      <VibeCopy k="home.vibesTitle" as="h2" className="font-display text-3xl display-fx sm:text-4xl" />
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        {vibes.map((v) => {
          const vibe = v.slug as Vibe;
          const covers = (tiles[vibe] ?? []).slice(0, 3);
          return (
            // Each card is skipped until it is near the viewport, so a phone does not fetch the display font and
            // texture of the vibes that are several screens down.
            <li key={v.slug} className="below-fold min-w-0 [--cv-h:9.5rem] sm:[--cv-h:26rem]">
              <VibeScope
                vibe={vibe}
                as="article"
                className="group relative flex h-full flex-row overflow-hidden sm:flex-col rounded-card bg-surface text-ink shadow-card transition-[transform,box-shadow] ease-vibe hover:-translate-y-1.5 hover:shadow-button has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus-ring"
              >
                {/* A phone gets a compact horizontal card (side cover) so the four moods take one screen, not four. */}
                <div className={cn("grid w-[8.5rem] flex-none place-items-center px-2 py-4 sm:w-auto sm:px-5 sm:py-7", ART[vibe])}>
                  <TileFan tiles={covers} size="card" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-4 sm:gap-2.5 sm:p-5">
                  <h3 className="font-display text-2xl leading-tight display-fx sm:text-3xl">
                    <Link
                      href={`/vibes/${v.slug}`}
                      className="outline-none after:absolute after:inset-0 after:content-['']"
                    >
                      {v.name}
                    </Link>
                  </h3>
                  <p className="line-clamp-3 text-sm text-ink-muted sm:line-clamp-none sm:text-base">{textOr(v.description, VIBE_TAGLINES[vibe])}</p>
                  <p className="mt-auto flex items-center justify-between pt-1 text-sm font-semibold sm:pt-2">
                    <span>{v.productCount} products</span>
                    <Icon
                      name="arrow-right"
                      className="size-6 transition-transform ease-vibe group-hover:translate-x-1"
                    />
                  </p>
                </div>
              </VibeScope>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
