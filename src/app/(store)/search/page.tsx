import type { Metadata } from "next";
import { Suspense } from "react";

import { ListingSection } from "@/components/store/listing/ListingSection";
import { ListingSkeleton } from "@/components/store/listing/ListingSkeleton";
import type { RawSearchParams } from "@/components/store/listing/params";
import { Button, Input } from "@/components/ui";
import { sanitizeSearchQuery } from "@/server/services/queries/shared";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

async function SearchResults({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;
  const rawQ = Array.isArray(raw.q) ? raw.q[0] : raw.q;
  const q = sanitizeSearchQuery(rawQ);
  return (
    <>
      <header className="mx-auto max-w-[1440px] px-4 pt-6 pb-2 sm:px-6">
        <h1 className="font-display text-4xl leading-tight display-fx sm:text-5xl">
          {q ? <>Results for &ldquo;{q}&rdquo;</> : "Search"}
        </h1>
        <form action="/search" method="get" role="search" className="mt-4 flex max-w-xl items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="search-page-q" className="sr-only">
              Search products
            </label>
            <Input
              id="search-page-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search charms, stickers, vibes..."
              maxLength={100}
            />
          </div>
          <Button type="submit" iconStart="search">
            Search
          </Button>
        </form>
      </header>
      <ListingSection basePath="/search" searchParams={Promise.resolve(raw)} mode="search" />
    </>
  );
}

export default function SearchPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return (
    <Suspense fallback={<ListingSkeleton />}>
      <SearchResults searchParams={searchParams} />
    </Suspense>
  );
}
