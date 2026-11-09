import type { Metadata } from "next";

import { HeroPoster } from "@/features/hero/HeroPoster";

import { FeaturedMix } from "../_home/FeaturedMix";
import { OfferBanners } from "../_home/OfferBanners";
import { TypeLinks } from "../_home/TypeLinks";
import { VibeCards } from "../_home/VibeCards";

export const metadata: Metadata = {
  title: "Shop charms, 3D stickers and DIY kits",
  description:
    "Charms, 3D stickers and DIY kits in four moods: Mochi, Chaos Cabinet, Unapologetic and After the Dark. Made in India.",
  alternates: { canonical: "/home" },
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
