import type { Metadata } from "next";

import { HeroPoster } from "@/features/hero/HeroPoster";

import { FeaturedForVibe } from "../_home/FeaturedForVibe";
import { OfferBanners } from "../_home/OfferBanners";
import { TypeLinks } from "../_home/TypeLinks";
import { VibeCards } from "../_home/VibeCards";

export const metadata: Metadata = {
  title: "Shop charms, Hippers, 3D stickers and DIY kits",
  description:
    "Charms, Hippers, 3D stickers and DIY kits in four moods: Mochi, Chaos Cabinet, Unapologetic and After the Dark. Made in India.",
  alternates: { canonical: "/home" },
};

export default function HomePage() {
  return (
    <>
      <HeroPoster />
      <VibeCards />
      <FeaturedForVibe />
      <OfferBanners />
      <TypeLinks />
    </>
  );
}
