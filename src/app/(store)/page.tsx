import type { Metadata } from "next";

import { JsonLd } from "@/components/store/JsonLd";
import { HeroPoster } from "@/features/hero/HeroPoster";
import { organizationJsonLd } from "@/lib/seo";
import { getStoreInfo } from "@/server/cache/settings";

import { FeaturedForVibe } from "./_home/FeaturedForVibe";
import { OfferBanners } from "./_home/OfferBanners";
import { TypeLinks } from "./_home/TypeLinks";
import { VibeCards } from "./_home/VibeCards";

export const metadata: Metadata = {
  title: { absolute: "IfOnli: charms, Hippers, 3D stickers and DIY kits" },
  description:
    "Charms, Hippers, 3D stickers and DIY kits in five moods: cute, bold, overthinking, gothic and funky. Made in India.",
  alternates: { canonical: "/" },
};

async function OrganizationLd() {
  const info = await getStoreInfo();
  return (
    <JsonLd
      data={organizationJsonLd({
        name: info.brandName,
        // Placeholders must not leak into structured data.
        legalName: info.legalName.isPlaceholder ? undefined : info.legalName.value,
        email: info.supportEmail.isPlaceholder ? undefined : info.supportEmail.value,
      })}
    />
  );
}

export default function HomePage() {
  return (
    <>
      <OrganizationLd />
      <HeroPoster />
      <VibeCards />
      <FeaturedForVibe />
      <OfferBanners />
      <TypeLinks />
    </>
  );
}
