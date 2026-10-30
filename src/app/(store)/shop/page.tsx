import type { Metadata } from "next";
import { Suspense } from "react";

import { JsonLd } from "@/components/store/JsonLd";
import { CollectionHeader } from "@/components/store/listing/CollectionHeader";
import { ListingSection } from "@/components/store/listing/ListingSection";
import { ListingSkeleton } from "@/components/store/listing/ListingSkeleton";
import type { RawSearchParams } from "@/components/store/listing/params";
import { breadcrumbJsonLd, type Crumb } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Shop all charms, Hippers, 3D stickers and DIY kits",
  description:
    "Every IfOnli charm, Hipper, 3D sticker and DIY kit in one place. Filter by vibe, type and price.",
  alternates: { canonical: "/shop" },
};

const CRUMBS: Crumb[] = [
  { name: "Home", path: "/" },
  { name: "Shop", path: "/shop" },
];

export default function ShopPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(CRUMBS)} />
      <CollectionHeader
        crumbs={CRUMBS}
        title="Shop everything"
        description="All five vibes, all four types. Filter to find your thing."
      />
      <Suspense fallback={<ListingSkeleton />}>
        <ListingSection basePath="/shop" searchParams={searchParams} />
      </Suspense>
    </>
  );
}
