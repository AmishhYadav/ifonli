import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { VibeChip } from "@/components/ui/Chip";
import { VIBES } from "@/features/vibe/config";
import { WishlistHeart } from "@/features/wishlist/WishlistHeart";
import { getCollections, getFeaturedForAllVibes } from "@/server/cache/catalog";

import { ProductCard } from "../ProductCard";
import { ProductGrid, ProductGridItem } from "../ProductGrid";
import { VibeCopy } from "../VibeCopy";

const SUGGESTION_COUNT = 4;

/**
 * Search with nothing to show. `none`: themed "no results" copy (the whole point of the five voices) with
 * ways forward: vibe chips, type links and popular products per vibe (all four rendered, CSS shows the
 * active one). `prompt`: an empty query.
 */
export async function NoResults({
  variant,
  q,
}: {
  variant: "none" | "prompt";
  q?: string;
}) {
  const [{ types }, featured] = await Promise.all([getCollections(), getFeaturedForAllVibes(8)]);

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-10 px-4 py-6 sm:px-6" data-testid="search-empty">
      <EmptyState
        icon="search"
        headingLevel="h2"
        title={
          variant === "none" ? (
            <VibeCopy k="search.noResultsTitle" />
          ) : (
            "What are you looking for?"
          )
        }
        action={
          <Button asChild variant="secondary">
            <Link href="/shop">Browse everything</Link>
          </Button>
        }
      >
        {variant === "none" ? (
          <>
            {q ? <span className="mb-2 block text-ink">No match for &ldquo;{q}&rdquo;.</span> : null}
            <VibeCopy k="search.noResultsBody" />
          </>
        ) : (
          "Search by product, vibe or type: try skull, sticker or gothic."
        )}
      </EmptyState>

      <section aria-label="Browse by vibe">
        <ul className="flex flex-wrap justify-center gap-3">
          {VIBES.map((v) => (
            <li key={v}>
              <VibeChip vibe={v} href={`/vibes/${v}`} />
            </li>
          ))}
          {types.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/types/${t.slug}`}
                className="inline-flex min-h-11 items-center rounded-button bg-surface-2 px-4 font-semibold text-ink transition-colors ease-vibe hover:bg-[color-mix(in_srgb,var(--surface-2),var(--ink)_9%)]"
              >
                {t.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Something to start with">
        <h2 className="mb-4 font-display text-2xl">Something to start with</h2>
        {VIBES.map((vibe) => {
          const cards = (featured[vibe] ?? []).slice(0, SUGGESTION_COUNT);
          if (cards.length === 0) return null;
          return (
            <div key={vibe} data-v={vibe}>
              <ProductGrid>
                {cards.map((product) => (
                  <ProductGridItem key={product.id}>
                    <ProductCard product={product} wishlist={<WishlistHeart productId={product.id} productName={product.name} />} />
                  </ProductGridItem>
                ))}
              </ProductGrid>
            </div>
          );
        })}
      </section>
    </div>
  );
}
