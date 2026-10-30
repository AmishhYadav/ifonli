import type { Metadata } from "next";

import { ProductCard, ProductCardSkeleton, ProductGrid, ProductGridItem } from "@/components/store";
import { IconButton, ToastProvider } from "@/components/ui";
import { VIBES, VIBE_NAMES } from "@/features/vibe/config";
import { HandButton } from "@/features/vibe/HandButton";
import { VibeScope } from "@/features/vibe/VibeScope";

import { assertDevPagesEnabled } from "../dev/gate";

import { GRID_PRODUCTS } from "./sample-data";
import { Specimen } from "./Specimen";

export const metadata: Metadata = {
  title: "Styleguide",
  robots: { index: false, follow: false },
};

const columnClasses = "min-w-0 rounded-card border border-border p-4 sm:p-5";

export default function StyleguidePage() {
  assertDevPagesEnabled();

  return (
    <ToastProvider>
      <main id="top" className="mx-auto flex max-w-[1680px] flex-col gap-12 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-center gap-4">
          <HandButton />
          <div>
            <h1 className="font-display text-4xl leading-tight display-fx sm:text-5xl">Styleguide</h1>
            <p className="text-sm text-ink-muted">
              UI primitives in every vibe and in Buy scope. Colour, shape, type and motion come from
              tokens only. Dev page.
            </p>
          </div>
        </header>

        <section aria-labelledby="columns" className="flex flex-col gap-4">
          <h2 id="columns" className="font-display text-2xl">
            Every vibe, side by side
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3" data-testid="columns">
            {VIBES.map((v) => (
              <VibeScope key={v} vibe={v} data-testid={`col-${v}`} className={columnClasses}>
                <h3 className="mb-5 font-display text-4xl leading-tight display-fx">{VIBE_NAMES[v]}</h3>
                <Specimen column={v} />
              </VibeScope>
            ))}
            <div
              data-vibe-scope="buy"
              data-testid="col-buy"
              className={`${columnClasses} bg-bg text-ink`}
            >
              <h3 className="mb-5 font-display text-4xl leading-tight display-fx">Buy scope</h3>
              <p className="-mt-3 mb-5 text-sm text-ink-muted">
                Palette of the active vibe; shape, type and texture reset to base.
              </p>
              <Specimen column="buy" />
            </div>
          </div>
        </section>

        <section aria-labelledby="grid" className="flex flex-col gap-4">
          <h2 id="grid" className="font-display text-2xl">
            Product cards (active vibe)
          </h2>
          <ProductGrid>
            {GRID_PRODUCTS.map(({ label, product }, i) => (
              <ProductGridItem key={product.slug}>
                <p className="mb-2 text-xs font-bold tracking-widest text-ink-muted uppercase">{label}</p>
                <ProductCard
                  product={product}
                  eager={i < 4}
                  wishlist={
                    <IconButton
                      icon="heart"
                      variant="ghost"
                      size="sm"
                      label={`Save ${product.name} to wishlist`}
                    />
                  }
                />
              </ProductGridItem>
            ))}
            <ProductGridItem>
              <p className="mb-2 text-xs font-bold tracking-widest text-ink-muted uppercase">Skeleton</p>
              <ProductCardSkeleton />
            </ProductGridItem>
          </ProductGrid>
        </section>
      </main>
    </ToastProvider>
  );
}
