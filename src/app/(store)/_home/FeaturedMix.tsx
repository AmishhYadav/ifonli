import Link from "next/link";

import { ProductCard, ProductGrid, ProductGridItem } from "@/components/store";
import { Icon } from "@/components/ui/Icon";
import { VIBES, VIBE_NAMES } from "@/features/vibe/config";
import { WishlistHeart } from "@/features/wishlist/WishlistHeart";
import { getHomeFeaturedForAllVibes } from "@/server/cache/catalog";

const FEATURED_SIZES = "(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw";
const FEATURED_COUNT = 8;

/**
 * "Fresh little finds": one grid dealt round-robin from the four vibes' featured sets (each product once), so the
 * home page shows Mochi, Chaos Cabinet, Unapologetic and After the Dark side by side whichever vibe is worn. Each
 * card keeps its own product art colours.
 */
export async function FeaturedMix() {
  const sets = await getHomeFeaturedForAllVibes(FEATURED_COUNT);
  const seen = new Set<string>();
  const cards = [];
  for (let i = 0; cards.length < FEATURED_COUNT && i < FEATURED_COUNT; i += 1) {
    for (const vibe of VIBES) {
      const card = sets[vibe]?.[i];
      if (!card || seen.has(card.id) || cards.length >= FEATURED_COUNT) continue;
      seen.add(card.id);
      cards.push(card);
    }
  }
  if (cards.length === 0) return null;

  return (
    <section aria-label="Featured products" className="below-fold mx-auto mt-16 max-w-[1440px] px-4 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-3xl display-fx sm:text-4xl">Fresh little finds</h2>
        <Link
          href="/shop"
          className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-link underline underline-offset-4 hover:no-underline"
        >
          Shop all
          <Icon name="arrow-right" className="size-4" />
        </Link>
      </div>
      <ProductGrid className="mt-6" data-testid="featured-mix">
        {cards.map((product) => (
          <ProductGridItem key={product.id}>
            <ProductCard
              product={product}
              sizes={FEATURED_SIZES}
              wishlist={<WishlistHeart productId={product.id} productName={product.name} />}
            />
          </ProductGridItem>
        ))}
      </ProductGrid>
      <p className="mt-4 text-sm text-ink-muted">
        A bit of every mood: {VIBES.map((v) => VIBE_NAMES[v]).join(", ")}.
      </p>
    </section>
  );
}
