import Link from "next/link";

import { ProductCard, ProductGrid, ProductGridItem } from "@/components/store";
import { VibeCopy } from "@/components/store/VibeCopy";
import { Icon } from "@/components/ui";
import { VIBE_NAMES, type Vibe } from "@/features/vibe/config";
import { getFeaturedForAllVibes } from "@/server/cache/catalog";
import { getVibeSettings } from "@/server/cache/settings";

const FEATURED_SIZES = "(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw";

/**
 * "Featured for your vibe": all five sets (default vibe first in the DOM), CSS shows the active one, so a
 * hand-button switch swaps products without any network request. Images are lazy, so only the visible set loads.
 */
export async function FeaturedForVibe() {
  const [sets, { cycle, defaultVibe }] = await Promise.all([
    getFeaturedForAllVibes(8),
    getVibeSettings(),
  ]);
  const first = defaultVibe === "random" ? cycle[0] : defaultVibe;
  const order = [first, ...cycle.filter((v) => v !== first)].filter((v): v is Vibe => Boolean(v));

  return (
    <section aria-label="Featured products" className="mx-auto mt-16 max-w-[1440px] px-4 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <VibeCopy k="home.featuredTitle" as="h2" className="font-display text-3xl display-fx sm:text-4xl" />
        <div>
          {order.map((vibe) => (
            <span key={vibe} data-v={vibe}>
              <Link
                href={`/vibes/${vibe}`}
                className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-link underline underline-offset-4 hover:no-underline"
              >
                Shop all {VIBE_NAMES[vibe]}
                <Icon name="arrow-right" className="size-4" />
              </Link>
            </span>
          ))}
        </div>
      </div>
      {order.map((vibe) => {
        const cards = sets[vibe] ?? [];
        if (cards.length === 0) return null;
        return (
          <div key={vibe} data-v={vibe}>
            <ProductGrid className="mt-6" data-testid={`featured-${vibe}`}>
              {cards.map((product) => (
                <ProductGridItem key={product.id}>
                  <ProductCard product={product} sizes={FEATURED_SIZES} />
                </ProductGridItem>
              ))}
            </ProductGrid>
          </div>
        );
      })}
    </section>
  );
}
