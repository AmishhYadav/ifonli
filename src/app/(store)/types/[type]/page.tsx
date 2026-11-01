import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { JsonLd } from "@/components/store/JsonLd";
import { CollectionHeader } from "@/components/store/listing/CollectionHeader";
import { ListingSection } from "@/components/store/listing/ListingSection";
import { ListingSkeleton } from "@/components/store/listing/ListingSkeleton";
import type { RawSearchParams } from "@/components/store/listing/params";
import { breadcrumbJsonLd, textOr, type Crumb } from "@/lib/seo";
import { getCollections } from "@/server/cache/catalog";

/**
 * Known slugs are prerendered (generateStaticParams). `params` is read before anything streams so an unknown
 * slug renders the themed not-found page (Next 16 Cache Components has no `dynamicParams = false`; the first
 * request for an unknown slug is answered 200 with the 404 UI and `noindex`, later ones 404).
 */
export const instant = false;

export async function generateStaticParams() {
  const { types } = await getCollections();
  return types.map((t) => ({ type: t.slug }));
}

async function findType(slug: string) {
  const { types } = await getCollections();
  return types.find((t) => t.slug === slug) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const type = await findType((await params).type);
  if (!type) return {};
  return {
    title: textOr(type.seoTitle, `${type.name} in every vibe`),
    description: textOr(
      type.seoDesc,
      `Shop IfOnli ${type.name}: Mochi, Chaos Cabinet, Unapologetic and After the Dark, all in one place.`,
    ),
    alternates: { canonical: `/types/${type.slug}` },
  };
}

export default async function TypePage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const type = await findType((await params).type);
  if (!type) notFound();

  const crumbs: Crumb[] = [
    { name: "Home", path: "/home" },
    { name: "Shop", path: "/shop" },
    { name: type.name, path: `/types/${type.slug}` },
  ];
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <CollectionHeader
        crumbs={crumbs}
        title={type.name}
        description={textOr(type.definition, `${type.name} in all four vibes.`)}
      />
      <Suspense fallback={<ListingSkeleton />}>
        <ListingSection
          basePath={`/types/${type.slug}`}
          searchParams={searchParams}
          fixed={{ type: type.slug }}
        />
      </Suspense>
    </>
  );
}
