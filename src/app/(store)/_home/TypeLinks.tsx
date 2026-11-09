import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { getCollections } from "@/server/cache/catalog";

/** Decorative accent dots (text stays on surface/ink, a checked pair in every vibe). */
const DOTS = ["bg-accent", "bg-accent-2", "bg-accent-3", "bg-accent-2"] as const;

/** Product-type entry points (Charms, 3D stickers, DIY): whichever types the shop has switched on. */
export async function TypeLinks() {
  const { types } = await getCollections();
  if (types.length === 0) return null;
  return (
    <section aria-labelledby="types-title" className="below-fold mx-auto mt-16 max-w-[1440px] px-4 sm:px-6">
      <h2 id="types-title" className="font-display text-3xl display-fx sm:text-4xl">
        Shop by type
      </h2>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {types.map((t, i) => (
          <li key={t.slug}>
            <Link
              href={`/types/${t.slug}`}
              className={cn(
                "group flex min-h-32 flex-col justify-between gap-6 rounded-card bg-surface p-5 text-ink shadow-card transition-[transform,box-shadow] ease-vibe hover:-translate-y-1 hover:shadow-button sm:p-6",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("size-8 rounded-full", DOTS[i % DOTS.length])}
              />
              <span className="font-display text-2xl leading-tight sm:text-3xl">{t.name}</span>
              <span className="flex items-center justify-between text-sm font-semibold">
                {t.productCount} products
                <Icon name="arrow-right" className="size-5 transition-transform ease-vibe group-hover:translate-x-1" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
