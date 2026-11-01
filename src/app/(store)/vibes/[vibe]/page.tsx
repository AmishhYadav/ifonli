import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { JsonLd } from "@/components/store/JsonLd";
import { Breadcrumbs } from "@/components/store/listing/CollectionHeader";
import { ListingSection } from "@/components/store/listing/ListingSection";
import { ListingSkeleton } from "@/components/store/listing/ListingSkeleton";
import { WearVibeButton } from "@/components/store/listing/WearVibeButton";
import type { RawSearchParams } from "@/components/store/listing/params";
import { VibeCopy } from "@/components/store/VibeCopy";
import { VIBE_TAGLINES } from "@/components/store/vibe-taglines";
import { isVibe } from "@/features/vibe/config";
import { VibeScope } from "@/features/vibe/VibeScope";
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
        {/* The header wears this collection's own tokens; the rest of the site keeps the active vibe. */}
        <VibeScope
          vibe={vibe.vibe}
          as="section"
          aria-label={`${vibe.name} vibe`}
          className="mt-4 flex flex-col gap-4 overflow-hidden rounded-card p-6 text-ink shadow-card sm:p-10"
        >
          <TileFan tiles={covers} size="lg" className="pointer-events-none absolute top-1/2 right-10 hidden -translate-y-1/2 lg:flex" />
          <p className="text-sm font-bold tracking-widest text-ink-muted uppercase">Vibe</p>
          <h1 className="font-display text-5xl leading-none display-fx sm:text-7xl">{vibe.name}</h1>
          <p className="max-w-2xl text-lg">{blurb}</p>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <WearVibeButton vibe={vibe.vibe}>
              <VibeCopy k="vibe.wearThis" />
            </WearVibeButton>
            <p className="text-base font-semibold">{vibe.productCount} products</p>
          </div>
        </VibeScope>
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
