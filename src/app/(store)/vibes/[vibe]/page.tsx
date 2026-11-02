import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { JsonLd } from "@/components/store/JsonLd";
import { Breadcrumbs } from "@/components/store/listing/CollectionHeader";
import { ListingSection } from "@/components/store/listing/ListingSection";
import { ListingSkeleton } from "@/components/store/listing/ListingSkeleton";
import type { RawSearchParams } from "@/components/store/listing/params";
import { VIBE_TAGLINES } from "@/components/store/vibe-taglines";
import { isVibe } from "@/features/vibe/config";
import { WearOnVisit } from "@/features/vibe/WearOnVisit";
import { breadcrumbJsonLd, textOr, type Crumb } from "@/lib/seo";
import { TileFan } from "@/components/store/TileFan";
import { getCollections, getHeroTilesForAllVibes } from "@/server/cache/catalog";

/**
 * Known slugs are prerendered (generateStaticParams). `params` is read before anything streams so an unknown
 * slug renders the themed not-found page (Next 16 Cache Components has no `dynamicParams = false`; the first
 * request for an unknown slug is answered 200 with the 404 UI and `noindex`, later ones 404).
 */
export const instant = false;

export async function generateStaticParams() {
  const { vibes } = await getCollections();
  return vibes.filter((v) => isVibe(v.slug)).map((v) => ({ vibe: v.slug }));
}

async function findVibe(slug: string) {
  if (!isVibe(slug)) return null;
  const { vibes } = await getCollections();
  const found = vibes.find((v) => v.slug === slug);
  return found ? { ...found, vibe: slug } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ vibe: string }>;
}): Promise<Metadata> {
  const vibe = await findVibe((await params).vibe);
  if (!vibe) return {};
  return {
    title: textOr(vibe.seoTitle, `${vibe.name} charms, stickers and accessories`),
    description: textOr(vibe.seoDesc, `${vibe.name} vibe: ${VIBE_TAGLINES[vibe.vibe]}`),
    alternates: { canonical: `/vibes/${vibe.slug}` },
  };
}

export default async function VibePage({
  params,
  searchParams,
}: {
  params: Promise<{ vibe: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const vibe = await findVibe((await params).vibe);
  if (!vibe) notFound();

  const crumbs: Crumb[] = [
    { name: "Home", path: "/home" },
    { name: "Shop", path: "/shop" },
    { name: vibe.name, path: `/vibes/${vibe.slug}` },
  ];
  const covers = (await getHeroTilesForAllVibes(3))[vibe.vibe] ?? [];
  const blurb = textOr(vibe.heroCopy, textOr(vibe.description, VIBE_TAGLINES[vibe.vibe]));

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <div className="mx-auto max-w-[1440px] px-4 pt-6 sm:px-6">
        <Breadcrumbs crumbs={crumbs} />
        {/* Visiting a collection wears its vibe site-wide, so this band needs no local re-skin. */}
        <WearOnVisit vibe={vibe.vibe} />
        <section
          aria-label={`${vibe.name} vibe`}
          data-testid="vibe-hero"
          className="relative isolate mt-4 flex flex-col gap-4 overflow-hidden rounded-card bg-surface p-6 text-ink shadow-card sm:p-10"
        >
          <TileFan tiles={covers} size="lg" className="pointer-events-none absolute top-1/2 right-10 hidden -translate-y-1/2 lg:flex" />
          <p className="text-sm font-bold tracking-widest text-ink-muted uppercase">Vibe</p>
          <h1 className="font-display text-5xl leading-none display-fx sm:text-7xl">{vibe.name}</h1>
          <p className="max-w-2xl text-lg">{blurb}</p>
          <p className="pt-2 text-base font-semibold">{vibe.productCount} products</p>
        </section>
      </div>
      <Suspense fallback={<ListingSkeleton />}>
        <ListingSection
          basePath={`/vibes/${vibe.slug}`}
          searchParams={searchParams}
          fixed={{ vibe: vibe.slug }}
        />
      </Suspense>
    </>
  );
}
