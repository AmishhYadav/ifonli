import type { Metadata } from "next";

import { HeroPoster } from "@/features/hero/HeroPoster";
import { DEFAULT_SHARE_IMAGE } from "@/lib/seo";

import { FeaturedMix } from "../_home/FeaturedMix";
import { OfferBanners } from "../_home/OfferBanners";
import { TypeLinks } from "../_home/TypeLinks";
import { VibeCards } from "../_home/VibeCards";

const TITLE = "Shop charms, 3D stickers and DIY kits";
const DESCRIPTION =
  "Charms, 3D stickers and DIY kits in four moods: Mochi, Chaos Cabinet, Unapologetic and After the Dark. Made in India.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/home" },
  // A page-level openGraph replaces the layout one, so the brand share card is passed explicitly.
  openGraph: {
    type: "website",
    siteName: "IfOnli",
    locale: "en_IN",
    title: `${TITLE} | IfOnli`,
    description: DESCRIPTION,
    url: "/home",
    images: [DEFAULT_SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | IfOnli`,
    description: DESCRIPTION,
    images: [DEFAULT_SHARE_IMAGE],
  },
};

/** The whole of IfOnli: all four moods on a neutral ground (html[data-mix], see MixMode), whichever vibe is worn. */
export default function HomePage() {
  return (
    <>
      <HeroPoster />
      <VibeCards />
      <TypeLinks />
      <FeaturedMix />
      <OfferBanners />
    </>
  );
}
