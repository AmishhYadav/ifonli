"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ProductCardSkeleton, ProductCardView } from "@/components/store/ProductCardView";
import { ProductGrid, ProductGridItem } from "@/components/store/ProductGrid";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

import { getWishlistItems, type WishlistItem } from "./actions";
import { getWishlist, pruneWishlist } from "./store";
import { WishlistHeart } from "./WishlistHeart";
import { useWishlistEntries } from "./useWishlist";

interface WishlistViewProps {
  /** Themed empty-state title (a `VibeCopy` from the server page). */
  emptyTitle: ReactNode;
  emptyBody: ReactNode;
}

const GRID_SIZES = "(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw";

/**
 * The guest wishlist: ids come from this device's `localStorage`, card data from a Server Action (fetched
 * once per product and kept in `loaded`; only ids still saved are listed, so un-hearting removes a card).
 */
export function WishlistView({ emptyTitle, emptyBody }: WishlistViewProps) {
  const entries = useWishlistEntries();
  const [loaded, setLoaded] = useState<Map<string, WishlistItem>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requested = useRef("");

  const ids = useMemo(() => entries?.map((e) => e.id) ?? null, [entries]);
  const idsKey = ids?.join(",") ?? null;

  useEffect(() => {
    if (ids === null) return;
    const missing = ids.filter((id) => !loaded.has(id));
    if (missing.length === 0) return;
    const key = `${attempt}:${missing.join(",")}`;
    if (requested.current === key) return;
    requested.current = key;
    let cancelled = false;
    void getWishlistItems(missing).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setLoaded((prev) => {
        const next = new Map(prev);
        for (const item of result.items) next.set(item.product.id, item);
        return next;
      });
      if (result.missingIds.length > 0) {
        // Keep everything saved NOW except the unknown ids: `ids` is from when the request started, and a
        // heart added meanwhile (another tab, another card) would otherwise be pruned with it.
        const gone = new Set(result.missingIds);
        pruneWishlist(new Set(getWishlist().map((e) => e.id).filter((id) => !gone.has(id))));
      }
    });
    return () => {
      cancelled = true;
      if (requested.current === key) requested.current = "";
    };
    // `loaded` is deliberately read through the closure: only a change of saved ids or a retry refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, attempt]);

  if (ids === null) {
    return (
      <ProductGrid aria-hidden="true" data-testid="wishlist-loading">
        {Array.from({ length: 4 }, (_, i) => (
          <ProductGridItem key={i}>
            <ProductCardSkeleton />
          </ProductGridItem>
        ))}
      </ProductGrid>
    );
  }

  if (ids.length === 0) {
    return (
      <EmptyState
        icon="heart"
        headingLevel="h2"
        title={emptyTitle}
        action={
          <Button asChild>
            <Link href="/shop">Browse everything</Link>
          </Button>
        }
      >
        {emptyBody}
      </EmptyState>
    );
  }

  const items = ids.map((id) => loaded.get(id)).filter((item): item is WishlistItem => Boolean(item));
  const waiting = items.length < ids.length && !error;

  return (
    <div className="flex flex-col gap-6">
      <p role="status" aria-live="polite" className="text-base font-semibold" data-testid="wishlist-count">
        {ids.length} saved {ids.length === 1 ? "product" : "products"}
      </p>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-card bg-surface shadow-card p-4">
          <p className="text-base">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : null}
      <h2 className="sr-only">Saved products</h2>
      <ProductGrid data-testid="wishlist-grid">
        {items.map(({ product, image, isCutout }, i) => (
          <ProductGridItem key={product.id}>
            <ProductCardView
              product={product}
              image={image}
              isCutout={isCutout}
              eager={i < 4}
              sizes={GRID_SIZES}
              wishlist={<WishlistHeart productId={product.id} productName={product.name} />}
            />
          </ProductGridItem>
        ))}
        {waiting
          ? Array.from({ length: ids.length - items.length }, (_, i) => (
              <ProductGridItem key={`s${i}`}>
                <ProductCardSkeleton />
              </ProductGridItem>
            ))
          : null}
      </ProductGrid>
    </div>
  );
}
